import type { ScheduledJob } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getTournamentById } from '../../database/repositories/tournament-repository.js';
import { getEntriesByTournament, updateEntryStatus } from '../../database/repositories/entry-repository.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { createGroup, addGroupMembership, updateGroupResources } from '../../database/repositories/group-repository.js';
import { createFixture } from '../../database/repositories/fixture-repository.js';
import { advanceTournamentTo, isAtOrPastStatus } from '../../services/tournament-progression-service.js';
import { ensureGroupResources } from '../../services/discord-resource-service.js';
import { generateGroups, groupCodeForIndex } from '../../domain/groups/group-generation.js';
import { generateRoundRobinFixtures } from '../../domain/fixtures/round-robin.js';
import { assertEntryTransition } from '../../domain/entries/state-machine.js';
import { resolveSchedule } from '../../domain/tournaments/schedule.js';
import { renderGroupFixturesGraphic } from '../../graphics/renderers/group-fixtures-renderer.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import type { TemplateSchedule } from '../../database/schema/tournament-templates.js';
import { DateTime } from 'luxon';

const ENTRY_STATUSES_EXCLUDED_FROM_ELIGIBILITY = ['WITHDRAWN', 'KICKED', 'DISQUALIFIED'] as const;

/**
 * Section 11's core pipeline: build the eligible pool, randomly draw exact
 * groups of 4 (+ reserves), persist everything, stand up each group's
 * Discord role/channels (section 12), generate its round-robin fixtures
 * (section 13), and post its fixture graphic (section 14). This is the
 * single highest-priority job handler — it's the one that makes the
 * tournament clock actually do something instead of just ticking.
 */
export async function handleGroupPublish(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const tournamentId = job.tournamentId;
  if (!tournamentId) throw new Error('GROUP_PUBLISH job is missing tournamentId');

  const tournament = await getTournamentById(ctx.db, tournamentId);
  if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);

  if (isAtOrPastStatus(tournament.status, 'GROUP_CONFIRMATION')) {
    ctx.logger.info({ tournamentId, status: tournament.status }, 'Groups already published for this tournament — skipping (idempotent)');
    return;
  }
  if (tournament.paused) {
    ctx.logger.warn({ tournamentId }, 'Tournament is paused — skipping group publish for now');
    return;
  }

  const guild = await ctx.client.guilds.fetch(tournament.guildId);
  const config = await getOrCreateGuildConfig(ctx.db, tournament.guildId);
  if (!config.groupCategoryId || !config.staffCategoryId) {
    throw new Error(`Guild ${tournament.guildId} is missing group/staff category configuration — run /setup configure`);
  }

  let current = await advanceTournamentTo(ctx.db, tournament, 'GENERATING_GROUPS');

  const allEntries = await getEntriesByTournament(ctx.db, tournamentId);
  const eligible = allEntries.filter(
    (e) => e.paymentStatus === 'PAYMENT_CONFIRMED' && !ENTRY_STATUSES_EXCLUDED_FROM_ELIGIBILITY.includes(e.entryStatus as (typeof ENTRY_STATUSES_EXCLUDED_FROM_ELIGIBILITY)[number]),
  );

  // Confirm every eligible entry still sitting at AWAITING_PAYMENT before
  // the draw — CONFIRMED is a prerequisite state for both GROUPED and
  // RESERVE per the entry state machine (section 45).
  const confirmedEntries = [];
  for (const entry of eligible) {
    if (entry.entryStatus === 'AWAITING_PAYMENT') {
      assertEntryTransition('AWAITING_PAYMENT', 'CONFIRMED');
      confirmedEntries.push(await updateEntryStatus(ctx.db, entry.id, entry.version, { entryStatus: 'CONFIRMED' }));
    } else {
      confirmedEntries.push(entry);
    }
  }

  const withClubNames = await Promise.all(
    confirmedEntries.map(async (entry) => {
      const club = await getClubById(ctx.db, entry.clubId);
      return { entry, teamName: club?.displayName ?? 'Unknown Team' };
    }),
  );

  const draw = generateGroups(withClubNames);
  ctx.logger.info({ tournamentId, groupCount: draw.groups.length, reserveCount: draw.reserves.length, seed: draw.seed }, 'Group draw complete');

  // Reserves: mark RESERVE with an ordering position (premium first, then
  // signup order — section 16). generateGroups doesn't reorder for this,
  // so sort the reserve slice the same way before assigning positions.
  const orderedReserves = [...draw.reserves].sort((a, b) => {
    if (a.entry.premiumAtSignup !== b.entry.premiumAtSignup) return a.entry.premiumAtSignup ? -1 : 1;
    return a.entry.signupTime.getTime() - b.entry.signupTime.getTime();
  });
  for (const [index, reserve] of orderedReserves.entries()) {
    assertEntryTransition(reserve.entry.entryStatus, 'RESERVE');
    await updateEntryStatus(ctx.db, reserve.entry.id, reserve.entry.version, { entryStatus: 'RESERVE', reservePosition: index + 1 });
  }

  const schedule = resolveSchedule(tournament.date, tournament.schedule as TemplateSchedule, config.timezone);

  for (const [groupIndex, groupDraw] of draw.groups.entries()) {
    const groupCode = groupCodeForIndex(groupIndex);
    const group = await createGroup(ctx.db, { tournamentId, groupCode });

    for (const [slotIndex, member] of groupDraw.entries.entries()) {
      await addGroupMembership(ctx.db, group.id, member.entry.id, slotIndex + 1);
      assertEntryTransition(member.entry.entryStatus, 'GROUPED');
      await updateEntryStatus(ctx.db, member.entry.id, member.entry.version, { entryStatus: 'GROUPED', groupId: group.id });
    }

    const resources = await ensureGroupResources(guild, group, config, ctx.logger);
    await updateGroupResources(ctx.db, group.id, {
      roleId: resources.role.id,
      chatChannelId: resources.chatChannel.id,
      resultsChannelId: resources.resultsChannel.id,
      staffChannelId: resources.staffChannel.id,
    });

    for (const member of groupDraw.entries) {
      for (const userId of [member.entry.managerUserId, member.entry.coManagerUserId].filter((id): id is string => !!id)) {
        try {
          const discordMember = await guild.members.fetch(userId);
          await discordMember.roles.add(resources.role, `Assigned to Group ${groupCode}`);
        } catch (error) {
          ctx.logger.warn({ error, userId, groupCode }, 'Could not assign group role — missing permission or member left');
        }
      }
    }

    const roundRobin = generateRoundRobinFixtures(groupDraw.entries);
    for (const fixture of roundRobin) {
      const scheduledAt =
        fixture.round === 1 ? schedule.roundOne : fixture.round === 2 ? schedule.roundTwo : schedule.roundThree;
      await createFixture(ctx.db, {
        tournamentId,
        groupId: group.id,
        stage: 'GROUP',
        roundNumber: fixture.round,
        homeEntryId: fixture.home.entry.id,
        awayEntryId: fixture.away.entry.id,
        scheduledAt: scheduledAt.toJSDate(),
        status: 'SCHEDULED',
      });
    }

    const graphicRounds = [1, 2, 3].map((roundNum) => ({
      roundLabel: roundNum === 1 ? 'Round One' : roundNum === 2 ? 'Round Two' : 'Round Three',
      timeLabel: DateTime.fromJSDate(
        (roundNum === 1 ? schedule.roundOne : roundNum === 2 ? schedule.roundTwo : schedule.roundThree).toJSDate(),
      ).toFormat('h:mm a'),
      matches: roundRobin
        .filter((f) => f.round === roundNum)
        .map((f) => ({ home: f.home.teamName, away: f.away.teamName })),
    }));

    const graphic = await renderGroupFixturesGraphic(
      { tournamentName: tournament.name, groupCode, rounds: graphicRounds },
      ctx.env.GRAPHICS_CACHE_DIR,
    );
    const message = await resources.resultsChannel.send({ files: [{ attachment: graphic.buffer, name: 'group-fixtures.png' }] });
    await updateGroupResources(ctx.db, group.id, { graphicMessageId: message.id });

    await recordAuditEvent(ctx.db, ctx.logger, {
      guildId: tournament.guildId,
      tournamentId,
      actorType: 'SYSTEM',
      action: 'group.publish',
      targetEntityType: 'group',
      targetEntityId: group.id,
      afterState: { groupCode, teamCount: groupDraw.entries.length, seed: draw.seed },
      correlationId: newCorrelationId(),
    });
  }

  await advanceTournamentTo(ctx.db, current, 'GROUP_CONFIRMATION');

  ctx.logger.info({ tournamentId, groups: draw.groups.length, reserves: draw.reserves.length }, 'Group publish complete');
}
