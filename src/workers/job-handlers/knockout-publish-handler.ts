import type { Tournament, KnockoutRound, Fixture } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { getGroupsByTournament, getGroupMemberships } from '../../database/repositories/group-repository.js';
import { getFixturesByGroup, getFixturesByKnockoutRound, createFixture } from '../../database/repositories/fixture-repository.js';
import { getEntryById, updateEntryStatus } from '../../database/repositories/entry-repository.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import {
  createKnockoutRound,
  getLatestKnockoutRound,
  updateKnockoutRoundResources,
} from '../../database/repositories/knockout-round-repository.js';
import { calculateQualification, type GroupStandingsInput } from '../../domain/qualification/qualification.js';
import { drawKnockoutPairings, stageForEntrantCount, STAGE_LABELS } from '../../domain/knockouts/knockout-draw.js';
import { assertEntryTransition } from '../../domain/entries/state-machine.js';
import { advanceTournamentTo } from '../../services/tournament-progression-service.js';
import { ensureKnockoutRoundResources } from '../../services/discord-resource-service.js';
import { computeGroupStandings } from '../../services/result-submission-service.js';
import { renderKnockoutBracketGraphic } from '../../graphics/renderers/knockout-bracket-renderer.js';
import { buildResultsPanelEmbed, buildResultsPanelComponents } from '../../discord/embeds/results-panel-embed.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';

export interface KnockoutPublishOptions {
  /** Same test-isolation mechanism as GroupPublishOptions.groupCodePrefix —
   * see ensureKnockoutRoundResources' doc for why this has to be threaded
   * through as its own parameter rather than baked into a code. */
  namePrefix?: string;
}

interface KnockoutEntrant {
  entryId: string;
  teamName: string;
}

interface PublishedRound {
  round: KnockoutRound;
  fixtures: Fixture[];
}

/** Draws, persists, and publishes one knockout round from a list of
 * entrants (either the group-stage qualifiers, for round 0, or the
 * previous round's winners) — shared by runInitialKnockoutDraw and
 * advanceKnockoutRound so the two never drift out of sync. */
async function publishKnockoutRound(
  ctx: AppContext,
  tournament: Tournament,
  entrants: KnockoutEntrant[],
  roundIndex: number,
  options: KnockoutPublishOptions,
): Promise<PublishedRound> {
  const guild = await ctx.client.guilds.fetch(tournament.guildId);
  const config = await getOrCreateGuildConfig(ctx.db, tournament.guildId);
  const namePrefix = options.namePrefix ?? '';

  const draw = drawKnockoutPairings(entrants);
  const stage = stageForEntrantCount(entrants.length);
  const stageLabel = STAGE_LABELS[stage];

  const round = await createKnockoutRound(ctx.db, {
    tournamentId: tournament.id,
    stage,
    roundIndex,
    status: 'ACTIVE',
    drawMetadata: { seed: String(draw.seed), order: draw.shuffledOrder.map((e) => e.entryId) },
    publishedAt: new Date(),
  });

  const resources = await ensureKnockoutRoundResources(guild, round, config, ctx.logger, namePrefix);
  let currentRound = await updateKnockoutRoundResources(ctx.db, round.id, {
    categoryId: resources.category.id,
    roleId: resources.role.id,
    chatChannelId: resources.chatChannel.id,
    resultsChannelId: resources.resultsChannel.id,
    staffChannelId: resources.staffChannel.id,
  });

  for (const entrant of entrants) {
    const entry = await getEntryById(ctx.db, entrant.entryId);
    if (!entry) continue;
    for (const userId of [entry.managerUserId, entry.coManagerUserId].filter((id): id is string => !!id)) {
      try {
        const member = await guild.members.fetch(userId);
        await member.roles.add(resources.role, `Advanced to ${stageLabel}`);
      } catch (error) {
        ctx.logger.warn({ error, userId, stage }, 'Could not assign knockout round role — missing permission or member left');
      }
    }
  }

  // Unlike group fixtures (which get pre-planned kickoff slots from the
  // tournament template), a knockout round is drawn dynamically — there's
  // no pre-set schedule for it to slot into. Ties become playable as soon
  // as the draw is published, matching how a cash cup's knockout stage
  // actually runs in practice (bracket drops, teams play same night).
  const knockoutKickoff = new Date();

  const createdFixtures: Fixture[] = [];
  for (const pairing of draw.pairings) {
    const fixture = await createFixture(ctx.db, {
      tournamentId: tournament.id,
      knockoutRoundId: currentRound.id,
      stage,
      roundNumber: 1,
      homeEntryId: pairing.home.entryId,
      awayEntryId: pairing.away.entryId,
      scheduledAt: knockoutKickoff,
      status: 'SCHEDULED',
    });
    createdFixtures.push(fixture);
    await ctx.scheduler.enqueue({
      tournamentId: tournament.id,
      jobType: 'FIXTURE_READY',
      runAt: knockoutKickoff,
      idempotencyKey: `FIXTURE_READY:${fixture.id}`,
      payload: { fixtureId: fixture.id },
    });
  }

  const graphic = await renderKnockoutBracketGraphic(
    {
      tournamentName: tournament.name,
      stageLabel,
      matchups: draw.pairings.map((p) => ({ home: p.home.teamName, away: p.away.teamName })),
    },
    ctx.env.GRAPHICS_CACHE_DIR,
  );
  const message = await resources.chatChannel.send({
    content: [
      `${resources.role} the draw is in for **${stageLabel}**!`,
      `Submit your results in ${resources.resultsChannel} once a match is played.`,
    ].join('\n'),
    files: [{ attachment: graphic.buffer, name: 'knockout-bracket.png' }],
    allowedMentions: { roles: [resources.role.id] },
  });
  await message.pin().catch((error) => {
    ctx.logger.warn({ error, stage }, 'Could not pin the bracket graphic — missing Manage Messages permission');
  });

  const panelEmbed = await buildResultsPanelEmbed(ctx, createdFixtures, stageLabel);
  const panelComponents = await buildResultsPanelComponents(ctx, createdFixtures);
  const panelMessage = await resources.resultsChannel.send({ embeds: [panelEmbed], components: panelComponents });

  currentRound = await updateKnockoutRoundResources(ctx.db, currentRound.id, {
    graphicMessageId: message.id,
    resultsPanelMessageId: panelMessage.id,
  });

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: tournament.guildId,
    tournamentId: tournament.id,
    actorType: 'SYSTEM',
    action: 'knockout_round.publish',
    targetEntityType: 'knockout_round',
    targetEntityId: currentRound.id,
    afterState: { stage, entrantCount: entrants.length, seed: draw.seed },
    correlationId: newCorrelationId(),
  });

  ctx.logger.info({ tournamentId: tournament.id, stage, entrantCount: entrants.length }, 'Knockout round published');
  return { round: currentRound, fixtures: createdFixtures };
}

/**
 * Section 21's qualification engine + section 22's draw, wired to real
 * data: computes standings for every group from its RESOLVED fixtures,
 * qualifies teams, and publishes the first knockout round. Call once every
 * group fixture in the tournament is RESOLVED — there's no automatic
 * trigger for that yet (see PLAN.md: dual-sided result submission, the
 * thing that would normally resolve group fixtures, isn't built), so
 * today this is invoked directly (by /tournament test's simulation, or a
 * future scheduler job once result submission exists).
 */
export async function runInitialKnockoutDraw(
  ctx: AppContext,
  tournament: Tournament,
  options: KnockoutPublishOptions = {},
): Promise<PublishedRound> {
  let current = await advanceTournamentTo(ctx.db, tournament, 'CALCULATING_QUALIFIERS');

  const groups = await getGroupsByTournament(ctx.db, tournament.id);
  if (groups.length === 0) {
    throw new Error(`Tournament ${tournament.id} has no groups — cannot calculate qualifiers.`);
  }

  const groupStandingsInputs: GroupStandingsInput[] = [];
  const entryIdsByGroup: string[][] = [];

  for (const group of groups) {
    const memberships = await getGroupMemberships(ctx.db, group.id);
    const groupFixtures = await getFixturesByGroup(ctx.db, group.id);

    const unresolved = groupFixtures.filter((f) => f.status !== 'RESOLVED');
    if (unresolved.length > 0) {
      throw new Error(`Group ${group.groupCode} has ${unresolved.length} unresolved fixture(s) — cannot calculate qualifiers yet.`);
    }

    entryIdsByGroup.push(memberships.map((m) => m.tournamentEntryId));
    const standings = await computeGroupStandings(ctx.db, group.id);
    groupStandingsInputs.push({ groupCode: group.groupCode, standings });
  }

  const autoQualifiersPerGroup = groups[0]!.qualificationSlots;
  const qualification = calculateQualification(groupStandingsInputs, autoQualifiersPerGroup);

  if (qualification.shortfall) {
    ctx.logger.warn(
      { tournamentId: tournament.id, targetBracketSize: qualification.targetBracketSize, actualQualifiers: qualification.allQualifiers.length },
      'Qualification shortfall: too few teams to reach the target bracket size even with wildcards — bracket will be smaller than usual.',
    );
  }

  let qualifiers = qualification.allQualifiers;
  if (qualifiers.length % 2 !== 0) {
    const dropped = qualifiers[qualifiers.length - 1]!;
    qualifiers = qualifiers.slice(0, -1);
    ctx.logger.warn(
      { tournamentId: tournament.id, droppedEntryId: dropped.entryId, droppedTeamName: dropped.teamName },
      'Odd qualifier count after the shortfall fallback — dropped the lowest-ranked qualifier to force an even bracket. Staff should review.',
    );
  }
  if (qualifiers.length < 2) {
    throw new Error(`Only ${qualifiers.length} qualifier(s) available — need at least 2 to run a knockout stage.`);
  }

  const qualifierIds = new Set(qualifiers.map((q) => q.entryId));
  for (const groupEntryIds of entryIdsByGroup) {
    for (const entryId of groupEntryIds) {
      const entry = await getEntryById(ctx.db, entryId);
      if (!entry || entry.entryStatus !== 'GROUPED') continue;
      assertEntryTransition(entry.entryStatus, 'ACTIVE');
      const active = await updateEntryStatus(ctx.db, entry.id, entry.version, { entryStatus: 'ACTIVE' });
      if (!qualifierIds.has(entryId)) {
        assertEntryTransition(active.entryStatus, 'ELIMINATED');
        await updateEntryStatus(ctx.db, active.id, active.version, { entryStatus: 'ELIMINATED' });
      }
    }
  }

  current = await advanceTournamentTo(ctx.db, current, 'QUALIFICATION_REVIEW');
  const targetStatus = qualifiers.length === 2 ? 'FINAL_LIVE' : 'KNOCKOUT_LIVE';
  current = await advanceTournamentTo(ctx.db, current, targetStatus);

  const entrants = qualifiers.map((q) => ({ entryId: q.entryId, teamName: q.teamName }));
  return publishKnockoutRound(ctx, current, entrants, 0, options);
}

export interface KnockoutAdvanceResult {
  completed: boolean;
  tournament: Tournament;
  winnerEntryId?: string;
  round?: KnockoutRound;
  fixtures?: Fixture[];
}

/**
 * Call once every fixture in the tournament's current (latest) knockout
 * round is RESOLVED. Eliminates every round's losers, and either declares
 * the sole remaining entrant tournament WINNER and closes the tournament
 * out (COMPLETED), or draws and publishes the next round from the
 * survivors.
 */
export async function advanceKnockoutRound(
  ctx: AppContext,
  tournament: Tournament,
  options: KnockoutPublishOptions = {},
): Promise<KnockoutAdvanceResult> {
  const latestRound = await getLatestKnockoutRound(ctx.db, tournament.id);
  if (!latestRound) {
    throw new Error(`Tournament ${tournament.id} has no knockout rounds yet — run the initial draw first.`);
  }

  const roundFixtures = await getFixturesByKnockoutRound(ctx.db, latestRound.id);
  const unresolved = roundFixtures.filter((f) => f.status !== 'RESOLVED');
  if (unresolved.length > 0) {
    throw new Error(`${STAGE_LABELS[latestRound.stage]} still has ${unresolved.length} unresolved fixture(s) — cannot advance yet.`);
  }

  await updateKnockoutRoundResources(ctx.db, latestRound.id, { status: 'COMPLETED', completedAt: new Date() });

  const winners: KnockoutEntrant[] = [];
  for (const fixture of roundFixtures) {
    if (!fixture.winnerEntryId) throw new Error(`Fixture ${fixture.id} is RESOLVED but has no winnerEntryId.`);
    const loserEntryId = fixture.winnerEntryId === fixture.homeEntryId ? fixture.awayEntryId : fixture.homeEntryId;

    const loser = await getEntryById(ctx.db, loserEntryId);
    if (loser && loser.entryStatus === 'ACTIVE') {
      assertEntryTransition('ACTIVE', 'ELIMINATED');
      await updateEntryStatus(ctx.db, loser.id, loser.version, { entryStatus: 'ELIMINATED' });
    }

    const winnerEntry = await getEntryById(ctx.db, fixture.winnerEntryId);
    if (!winnerEntry) throw new Error(`Winner entry ${fixture.winnerEntryId} not found.`);
    const club = await getClubById(ctx.db, winnerEntry.clubId);
    winners.push({ entryId: winnerEntry.id, teamName: club?.displayName ?? 'Unknown Team' });
  }

  if (winners.length === 1) {
    const champion = await getEntryById(ctx.db, winners[0]!.entryId);
    if (champion && champion.entryStatus === 'ACTIVE') {
      assertEntryTransition('ACTIVE', 'WINNER');
      await updateEntryStatus(ctx.db, champion.id, champion.version, { entryStatus: 'WINNER' });
    }

    let current = tournament;
    if (current.status !== 'FINAL_LIVE') current = await advanceTournamentTo(ctx.db, current, 'FINAL_LIVE');
    current = await advanceTournamentTo(ctx.db, current, 'COMPLETED');

    const guild = await ctx.client.guilds.fetch(tournament.guildId);
    if (latestRound.resultsChannelId) {
      const channel = await guild.channels.fetch(latestRound.resultsChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel.send(`🏆 **${winners[0]!.teamName}** are the champions of **${tournament.name}**!`);
      }
    }

    await recordAuditEvent(ctx.db, ctx.logger, {
      guildId: tournament.guildId,
      tournamentId: tournament.id,
      actorType: 'SYSTEM',
      action: 'tournament.complete',
      targetEntityType: 'tournament',
      targetEntityId: tournament.id,
      afterState: { winnerEntryId: winners[0]!.entryId, winnerTeamName: winners[0]!.teamName },
      correlationId: newCorrelationId(),
    });

    return { completed: true, tournament: current, winnerEntryId: winners[0]!.entryId };
  }

  const targetStatus = winners.length === 2 ? 'FINAL_LIVE' : 'KNOCKOUT_LIVE';
  let current = tournament;
  if (current.status !== targetStatus) current = await advanceTournamentTo(ctx.db, current, targetStatus);

  const published = await publishKnockoutRound(ctx, current, winners, latestRound.roundIndex + 1, options);
  return { completed: false, tournament: current, round: published.round, fixtures: published.fixtures };
}
