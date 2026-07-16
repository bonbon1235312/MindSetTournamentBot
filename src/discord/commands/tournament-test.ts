import { randomUUID } from 'node:crypto';
import { EmbedBuilder, type ChatInputCommandInteraction, type SlashCommandSubcommandBuilder } from 'discord.js';
import { DateTime } from 'luxon';
import type { AppContext } from '../../types/context.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { getActiveRulesVersion } from '../../database/repositories/rules-repository.js';
import { createTournament, getTournamentById, deleteTournament } from '../../database/repositories/tournament-repository.js';
import { findOrCreateClub, deleteClub } from '../../database/repositories/club-repository.js';
import { createEntry } from '../../database/repositories/entry-repository.js';
import { getGroupMemberships } from '../../database/repositories/group-repository.js';
import { getFixturesByGroup } from '../../database/repositories/fixture-repository.js';
import { runGroupPublishPipeline, type GroupPublishResult } from '../../workers/job-handlers/group-publish-handler.js';
import { DEFAULT_ENTRY_FEE_PENCE, DEFAULT_SCHEDULE } from '../../config/constants.js';
import { MissingConfigurationError } from '../../types/errors.js';
import type { Tournament } from '../../database/schema/index.js';

interface PhaseResult {
  name: string;
  ok: boolean;
  detail: string;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 500 ? `${message.slice(0, 500)}…` : message;
}

export function addTournamentTestSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub
    .setName('test')
    .setDescription('Run an end-to-end diagnostic with fake signups (staff only)')
    .addIntegerOption((opt) =>
      opt.setName('team_count').setDescription('How many fake teams to simulate (default 8)').setMinValue(1).setMaxValue(40).setRequired(false),
    )
    .addBooleanOption((opt) =>
      opt.setName('cleanup').setDescription('Delete everything the test created afterwards (default true)').setRequired(false),
    );
}

/**
 * Runs fake club/entry creation through the real group-publish pipeline —
 * the same code path the tournament clock uses at kickoff — so staff can
 * see exactly where it breaks against their actual guild config, without
 * waiting for a real signup window or a real kickoff time. Every phase is
 * wrapped individually so one failure doesn't hide what came after it in
 * the report, and by default everything it creates (Discord role/channels,
 * database rows) is deleted again afterward.
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
  // REAL tournament's "Group A" Discord channels by name collision.
  const groupCodePrefix = `test-${runId}-`;

  const phases: PhaseResult[] = [];
  let tournament: Tournament | undefined;
  const clubIds: string[] = [];
  let pipelineResult: GroupPublishResult | undefined;

  try {
    const config = await getOrCreateGuildConfig(ctx.db, guildId);
    if (!config.groupCategoryId || !config.staffCategoryId) {
      throw new MissingConfigurationError(['Group category', 'Staff category']);
    }
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
      const club = await findOrCreateClub(ctx.db, guildId, `TEST-${runId} FC ${i}`, `test-${runId} fc ${i}`);
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
        if (!group.roleId || !group.chatChannelId || !group.resultsChannelId || !group.staffChannelId) {
          throw new Error(`Group ${group.groupCode} is missing a Discord role or channel`);
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

  let cleanedUp = false;
  if (cleanup) {
    try {
      for (const group of pipelineResult?.groups ?? []) {
        if (group.chatChannelId) await guild.channels.delete(group.chatChannelId).catch(() => {});
        if (group.resultsChannelId) await guild.channels.delete(group.resultsChannelId).catch(() => {});
        if (group.staffChannelId) await guild.channels.delete(group.staffChannelId).catch(() => {});
        if (group.roleId) await guild.roles.delete(group.roleId).catch(() => {});
      }
      await deleteTournament(ctx.db, tournament.id); // cascades entries/groups/memberships/fixtures
      for (const clubId of clubIds) await deleteClub(ctx.db, clubId);
      cleanedUp = true;
      phases.push({ name: 'Clean up test data', ok: true, detail: 'All test Discord resources and database rows removed' });
    } catch (error) {
      phases.push({
        name: 'Clean up test data',
        ok: false,
        detail: `${errorMessage(error)} — check the guild manually for leftover "group-${groupCodePrefix}*" channels/roles`,
      });
    }
  } else {
    phases.push({
      name: 'Clean up test data',
      ok: true,
      detail: `Skipped (cleanup:false) — test channels are prefixed "group-${groupCodePrefix}", tournament \`${tournament.id}\`. Nothing deletes these automatically; remove them manually when done.`,
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
