import { randomUUID } from 'node:crypto';
import { EmbedBuilder, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import type { AppContext } from '../../types/context.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { getActiveRulesVersion } from '../../database/repositories/rules-repository.js';
import { createTournament, getTournamentById, deleteTournament } from '../../database/repositories/tournament-repository.js';
import { findOrCreateClub, deleteClub, getClubById } from '../../database/repositories/club-repository.js';
import { createEntry, getEntryById } from '../../database/repositories/entry-repository.js';
import { getGroupMemberships } from '../../database/repositories/group-repository.js';
import { getFixturesByGroup, getFixturesByKnockoutRound, resolveFixtureResult } from '../../database/repositories/fixture-repository.js';
import { runGroupPublishPipeline, type GroupPublishResult } from '../../workers/job-handlers/group-publish-handler.js';
import { runInitialKnockoutDraw, advanceKnockoutRound } from '../../workers/job-handlers/knockout-publish-handler.js';
import { STAGE_LABELS } from '../../domain/knockouts/knockout-draw.js';
import { DEFAULT_ENTRY_FEE_PENCE, DEFAULT_SCHEDULE } from '../../config/constants.js';
import type { Tournament, KnockoutRound, Fixture } from '../../database/schema/index.js';
import type { DecisionMethod } from '../../database/schema/enums.js';

interface PhaseResult {
  name: string;
  ok: boolean;
  detail: string;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

/** 0-4, uniform — good enough for fake test data, not meant to model
 * realistic score distributions. */
function randomScore(): number {
  return Math.floor(Math.random() * 5);
}

/** Resolves every fixture in a completed group round-robin with a fake
 * score (draws allowed) so standings/qualification have something real to
 * compute from — this is what lets /tournament test exercise the knockout
 * pipeline without dual-sided result submission existing yet. */
async function simulateFixtureResults(ctx: AppContext, fixturesToResolve: Fixture[], allowDraws: boolean): Promise<void> {
  for (const fixture of fixturesToResolve) {
    let homeScore = randomScore();
    let awayScore = randomScore();
    let decisionMethod: DecisionMethod = 'NORMAL';
    if (!allowDraws && homeScore === awayScore) {
      // Knockout ties get "resolved on penalties" — just needs *a* winner
      // for this simulation, not a realistic penalty score.
      homeScore += 1;
      decisionMethod = 'PENALTIES';
    }
    const winnerEntryId =
      homeScore > awayScore ? fixture.homeEntryId : awayScore > homeScore ? fixture.awayEntryId : null;

    await resolveFixtureResult(ctx.db, fixture.id, fixture.version, {
      homeScore,
      awayScore,
      winnerEntryId,
      decisionMethod,
      // No dedicated "simulated" resolution source exists (and adding one
      // just for this diagnostic isn't worth a schema change) — STAFF_OVERRIDE
      // is the closest honest fit: this result did not come from a real
      // dual-sided submission.
      resolutionSource: 'STAFF_OVERRIDE',
    });
  }
}

export function addTournamentTestSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .setName('test')
    .setDescription('Run an end-to-end diagnostic with fake signups (staff only)')
    .addIntegerOption((opt) =>
      opt.setName('team_count').setDescription('How many fake teams to simulate (default 8, no upper limit)').setMinValue(1).setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt.setName('cleanup').setDescription('Delete everything the test created afterwards (default true)').setRequired(false),
    );
}

/**
 * Runs fake club/entry creation through the real group-publish AND
 * knockout-publish pipelines — the same code paths a real cup uses — so
 * staff can see exactly where either breaks against their actual guild
 * config, without waiting for a real signup window, real submitted
 * results, or a real kickoff time. Every phase is wrapped individually so
 * one failure doesn't hide what came after it in the report, and by
 * default everything it creates (Discord role/category/channels, database
 * rows) is deleted again afterward.
 */
export async function executeTournamentTest(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const teamCount = interaction.options.getInteger('team_count') ?? 8;
  const cleanup = interaction.options.getBoolean('cleanup') ?? true;
  const guildId = interaction.guildId;
  const guild = interaction.guild;
  const runId = randomUUID().slice(0, 8);
  // See runGroupPublishPipeline's GroupPublishOptions doc: this prefix is
  // what stops a test run from ever resolving (and silently reusing) a
  // REAL tournament's "Group A" Discord channels by name collision. It's
  // deliberately static (not per-run-random) — the only thing that has to
  // stay unique is TEST vs a REAL cup's plain "A"/"B"/... codes, which a
  // real tournament never has. A leftover, un-cleaned-up previous test run
  // sharing this same "TEST-" prefix just gets found-and-reused by name
  // (same idempotent pattern group-publish uses everywhere else), not
  // duplicated — harmless, and far more readable than a random suffix.
  const groupCodePrefix = 'TEST-';
  const knockoutNamePrefix = 'TEST ';

  const phases: PhaseResult[] = [];
  let tournament: Tournament | undefined;
  const clubIds: string[] = [];
  let pipelineResult: GroupPublishResult | undefined;
  const knockoutRounds: KnockoutRound[] = [];
  let championName: string | undefined;

  try {
    const config = await getOrCreateGuildConfig(ctx.db, guildId);
    const rulesVersion = await getActiveRulesVersion(ctx.db, guildId);

    tournament = await createTournament(ctx.db, {
      guildId,
      name: `TEST RUN ${runId}`,
      date: DateTime.now().setZone(config.timezone).toISODate() ?? DateTime.now().toISODate()!,
      entryFeePence: DEFAULT_ENTRY_FEE_PENCE,
      prizeConfiguration: { mode: 'CONFIRMED_TEAMS_TIMES_FEE' },
      schedule: DEFAULT_SCHEDULE,
      status: 'SIGNUP_CLOSED',
    });
    phases.push({ name: 'Create test tournament', ok: true, detail: `\`${tournament.id}\`` });

    let created = 0;
    for (let i = 1; i <= teamCount; i++) {
      const club = await findOrCreateClub(ctx.db, guildId, `TEST FC ${i}`, `test fc ${i}`);
      clubIds.push(club.id);
      // Using the real staff member running this command as manager (for
      // every fake team) so Discord role-assignment actually succeeds and
      // is genuinely exercised, not just its failure path.
      await createEntry(ctx.db, {
        tournamentId: tournament.id,
        clubId: club.id,
        managerUserId: interaction.user.id,
        paymentStatus: 'PAYMENT_CONFIRMED',
        paymentConfirmedBy: interaction.user.id,
        paymentConfirmedAt: new Date(),
        rulesVersionId: rulesVersion.id,
        entryStatus: 'AWAITING_PAYMENT',
      });
      created++;
    }
    phases.push({ name: `Create ${teamCount} fake signup(s)`, ok: true, detail: `${created} entries created, all payment-confirmed` });
  } catch (error) {
    phases.push({ name: 'Setup', ok: false, detail: errorMessage(error) });
    await sendReport(interaction, phases, { teamCount, runId, cleanedUp: false });
    return;
  }

  try {
    pipelineResult = await runGroupPublishPipeline(ctx, tournament, { groupCodePrefix });
    phases.push({
      name: 'Run group-publish pipeline',
      ok: true,
      detail: `${pipelineResult.groups.length} group(s) formed, ${pipelineResult.reserveCount} reserve(s), seed ${pipelineResult.seed}`,
    });
  } catch (error) {
    phases.push({ name: 'Run group-publish pipeline', ok: false, detail: errorMessage(error) });
  }

  if (pipelineResult) {
    try {
      let membershipTotal = 0;
      let fixtureTotal = 0;
      for (const group of pipelineResult.groups) {
        const memberships = await getGroupMemberships(ctx.db, group.id);
        const groupFixtures = await getFixturesByGroup(ctx.db, group.id);
        membershipTotal += memberships.length;
        fixtureTotal += groupFixtures.length;
        if (memberships.length !== 4) throw new Error(`Group ${group.groupCode} has ${memberships.length} members, expected 4`);
        if (groupFixtures.length !== 6) throw new Error(`Group ${group.groupCode} has ${groupFixtures.length} fixtures, expected 6`);
        if (!group.categoryId || !group.roleId || !group.chatChannelId || !group.resultsChannelId || !group.staffChannelId) {
          throw new Error(`Group ${group.groupCode} is missing a Discord category, role, or channel`);
        }
        if (!group.graphicMessageId) throw new Error(`Group ${group.groupCode} never posted its fixtures graphic`);
      }

      const finalTournament = await getTournamentById(ctx.db, tournament.id);
      if (finalTournament?.status !== 'GROUP_CONFIRMATION') {
        throw new Error(`Tournament status is ${finalTournament?.status ?? 'unknown'}, expected GROUP_CONFIRMATION`);
      }

      phases.push({
        name: 'Verify results',
        ok: true,
        detail: `${membershipTotal} memberships, ${fixtureTotal} fixtures, status = ${finalTournament.status}`,
      });
    } catch (error) {
      phases.push({ name: 'Verify results', ok: false, detail: errorMessage(error) });
    }
  }

  if (pipelineResult && phases.at(-1)?.ok) {
    try {
      for (const group of pipelineResult.groups) {
        const groupFixtures = await getFixturesByGroup(ctx.db, group.id);
        await simulateFixtureResults(ctx, groupFixtures, true);
      }
      phases.push({ name: 'Simulate group results', ok: true, detail: 'Every group fixture resolved with a fake score' });
    } catch (error) {
      phases.push({ name: 'Simulate group results', ok: false, detail: errorMessage(error) });
    }
  }

  if (phases.at(-1)?.ok && phases.some((p) => p.name === 'Simulate group results')) {
    try {
      // Must re-fetch: runGroupPublishPipeline advanced the tournament's
      // status (and bumped its version) multiple times internally, so the
      // `tournament` captured back at creation is stale — passing it
      // straight into runInitialKnockoutDraw would fail optimistic-lock.
      const preKnockoutTournament = await getTournamentById(ctx.db, tournament.id);
      if (!preKnockoutTournament) throw new Error('Tournament disappeared before the knockout draw.');

      const initialDraw = await runInitialKnockoutDraw(ctx, preKnockoutTournament, { namePrefix: knockoutNamePrefix });
      knockoutRounds.push(initialDraw.round);

      let latestRound = initialDraw.round;
      let result: Awaited<ReturnType<typeof advanceKnockoutRound>> | undefined;
      let guardRounds = 0;

      while (!result?.completed) {
        guardRounds += 1;
        if (guardRounds > 10) throw new Error('Knockout stage did not complete within 10 rounds — likely a bug.');

        const roundFixtures = await getFixturesByKnockoutRound(ctx.db, latestRound.id);
        await simulateFixtureResults(ctx, roundFixtures, false);

        const currentTournament = await getTournamentById(ctx.db, tournament.id);
        if (!currentTournament) throw new Error('Tournament disappeared mid-knockout-stage.');

        result = await advanceKnockoutRound(ctx, currentTournament, { namePrefix: knockoutNamePrefix });
        if (!result.completed && result.round) {
          knockoutRounds.push(result.round);
          latestRound = result.round;
        }
      }

      if (result.winnerEntryId) {
        const champion = await getEntryById(ctx.db, result.winnerEntryId);
        if (champion) {
          const club = await getClubById(ctx.db, champion.clubId);
          championName = club?.displayName;
        }
      }

      phases.push({
        name: 'Run knockout pipeline',
        ok: true,
        detail: `${knockoutRounds.length} round(s) played (${knockoutRounds.map((r) => STAGE_LABELS[r.stage]).join(' → ')}) — champion: ${championName ?? 'unknown'}`,
      });
    } catch (error) {
      phases.push({ name: 'Run knockout pipeline', ok: false, detail: errorMessage(error) });
    }
  }

  if (phases.at(-1)?.ok && phases.some((p) => p.name === 'Run knockout pipeline')) {
    try {
      for (const round of knockoutRounds) {
        if (!round.categoryId || !round.roleId || !round.chatChannelId || !round.resultsChannelId || !round.staffChannelId) {
          throw new Error(`${STAGE_LABELS[round.stage]} is missing a Discord category, role, or channel`);
        }
        if (!round.graphicMessageId) throw new Error(`${STAGE_LABELS[round.stage]} never posted its bracket graphic`);
      }

      const finalTournament = await getTournamentById(ctx.db, tournament.id);
      if (finalTournament?.status !== 'COMPLETED') {
        throw new Error(`Tournament status is ${finalTournament?.status ?? 'unknown'}, expected COMPLETED`);
      }

      phases.push({
        name: 'Verify knockout results',
        ok: true,
        detail: `All ${knockoutRounds.length} round(s) fully resourced, tournament status = ${finalTournament.status}`,
      });
    } catch (error) {
      phases.push({ name: 'Verify knockout results', ok: false, detail: errorMessage(error) });
    }
  }

  let cleanedUp = false;
  if (cleanup) {
    try {
      for (const group of pipelineResult?.groups ?? []) {
        if (group.chatChannelId) await guild.channels.delete(group.chatChannelId).catch(() => {});
        if (group.resultsChannelId) await guild.channels.delete(group.resultsChannelId).catch(() => {});
        if (group.staffChannelId) await guild.channels.delete(group.staffChannelId).catch(() => {});
        // Safe to remove — every group now gets its own category (not a
        // shared one), so a test run's category is exclusively test debris.
        if (group.categoryId) await guild.channels.delete(group.categoryId).catch(() => {});
        if (group.roleId) await guild.roles.delete(group.roleId).catch(() => {});
      }
      for (const round of knockoutRounds) {
        if (round.chatChannelId) await guild.channels.delete(round.chatChannelId).catch(() => {});
        if (round.resultsChannelId) await guild.channels.delete(round.resultsChannelId).catch(() => {});
        if (round.staffChannelId) await guild.channels.delete(round.staffChannelId).catch(() => {});
        if (round.categoryId) await guild.channels.delete(round.categoryId).catch(() => {});
        if (round.roleId) await guild.roles.delete(round.roleId).catch(() => {});
      }
      await deleteTournament(ctx.db, tournament.id); // cascades entries/groups/memberships/fixtures/knockout_rounds
      for (const clubId of clubIds) await deleteClub(ctx.db, clubId);
      cleanedUp = true;
      phases.push({ name: 'Clean up test data', ok: true, detail: 'All test Discord resources and database rows removed' });
    } catch (error) {
      phases.push({
        name: 'Clean up test data',
        ok: false,
        detail: `${errorMessage(error)} — check the guild manually for leftover "${groupCodePrefix}*"/"${knockoutNamePrefix}*" channels/roles`,
      });
    }
  } else {
    phases.push({
      name: 'Clean up test data',
      ok: true,
      detail: `Skipped (cleanup:false) — test channels are prefixed "group-${groupCodePrefix}" / "${knockoutNamePrefix}", tournament \`${tournament.id}\`. Nothing deletes these automatically; remove them manually when done.`,
    });
  }

  await sendReport(interaction, phases, { teamCount, runId, cleanedUp: cleanup ? cleanedUp : null });
}

async function sendReport(
  interaction: ChatInputCommandInteraction,
  phases: PhaseResult[],
  meta: { teamCount: number; runId: string; cleanedUp: boolean | null },
): Promise<void> {
  const allOk = phases.every((p) => p.ok);
  const embed = new EmbedBuilder()
    .setColor(allOk ? '#2ECC71' : '#C0392B')
    .setAuthor({ name: 'MindSet Tournament Bot  ·  Test Run Report' })
    .setDescription(`Run \`${meta.runId}\` · ${meta.teamCount} fake team(s) · ${allOk ? '✅ All phases passed' : '❌ At least one phase failed'}`)
    .addFields(phases.map((p) => ({ name: `${p.ok ? '✅' : '❌'} ${p.name}`, value: p.detail || '—', inline: false })))
    .setFooter({ text: meta.cleanedUp === null ? 'Cleanup skipped by request' : meta.cleanedUp ? 'Test data cleaned up' : 'Cleanup FAILED — see above' })
    .setTimestamp(new Date());

  await interaction.followUp({ embeds: [embed], ephemeral: true });
}
