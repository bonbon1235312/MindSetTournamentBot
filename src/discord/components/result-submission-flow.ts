import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
} from 'discord.js';
import type { AppContext } from '../../types/context.js';
import type { Fixture } from '../../database/schema/index.js';
import { getFixtureById } from '../../database/repositories/fixture-repository.js';
import { getEntryById } from '../../database/repositories/entry-repository.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { isStaffMember } from '../permissions/staff.js';
import {
  processManagerSubmission,
  processStaffOverride,
  getFixtureParentContext,
  getFixtureSubmissions,
  resolveSubmittingEntryId,
  isStaffOverridable,
  type FixtureParentContext,
} from '../../services/result-submission-service.js';
import { resolveFixtureResult } from '../../database/repositories/fixture-repository.js';
import { assertFixtureTransition } from '../../domain/fixtures/state-machine.js';
import { buildResultsPanelEmbed, buildResultsPanelComponents, buildConflictPanelEmbed, buildConflictPanelComponents } from '../embeds/results-panel-embed.js';
import { encodeCustomId, decodeCustomId } from '../interactions/custom-id.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import { NotFoundError, PermissionError, StalePanelError, ValidationError } from '../../types/errors.js';

const NAMESPACE = 'fixture';

function parseScoreInput(raw: string, label: string): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) throw new ValidationError(`${label} must be a whole number (0 or more).`);
  return Number.parseInt(trimmed, 10);
}

function parseOptionalPenaltyInput(raw: string, label: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  return parseScoreInput(trimmed, label);
}

async function teamNames(ctx: AppContext, fixture: Fixture): Promise<{ home: string; away: string }> {
  const [homeEntry, awayEntry] = await Promise.all([getEntryById(ctx.db, fixture.homeEntryId), getEntryById(ctx.db, fixture.awayEntryId)]);
  const [homeClub, awayClub] = await Promise.all([
    homeEntry ? getClubById(ctx.db, homeEntry.clubId) : undefined,
    awayEntry ? getClubById(ctx.db, awayEntry.clubId) : undefined,
  ]);
  return { home: homeClub?.displayName ?? 'Unknown team', away: awayClub?.displayName ?? 'Unknown team' };
}

/** Re-fetches the fixture's group/round, rebuilds the results panel from
 * every fixture in it, and edits the stored panel message in place — same
 * "edit, never spam" convention as the tournament announcement embed. */
async function refreshResultsPanel(ctx: AppContext, guild: Guild, parent: FixtureParentContext): Promise<void> {
  if (!parent.resultsChannelId || !parent.resultsPanelMessageId) return;
  const channel = await guild.channels.fetch(parent.resultsChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const message = await channel.messages.fetch(parent.resultsPanelMessageId).catch(() => null);
  if (!message) return;

  const fixtures = await parent.getAllFixtures(ctx.db);
  const embed = await buildResultsPanelEmbed(ctx, fixtures, parent.label);
  const components = await buildResultsPanelComponents(ctx, fixtures);
  await message.edit({ embeds: [embed], components }).catch((error) => {
    ctx.logger.warn({ error }, 'Could not refresh the results panel');
  });
}

async function postConflictPanel(ctx: AppContext, guild: Guild, parent: FixtureParentContext, fixture: Fixture): Promise<void> {
  if (!parent.staffChannelId) return;
  const channel = await guild.channels.fetch(parent.staffChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const submissions = await getFixtureSubmissions(ctx.db, fixture.id);
  if (submissions.length < 2) return;
  const [a, b] = submissions;
  const { home, away } = await teamNames(ctx, fixture);

  const embed = buildConflictPanelEmbed(
    home,
    away,
    {
      submitterLabel: `<@${a!.submittingUserId}>`,
      canonical: {
        homeScore: a!.canonicalHomeScore,
        awayScore: a!.canonicalAwayScore,
        decisionMethod: a!.decisionMethod,
        penaltyHome: a!.penaltyHome,
        penaltyAway: a!.penaltyAway,
        winnerEntryId: a!.declaredWinnerEntryId,
      },
    },
    {
      submitterLabel: `<@${b!.submittingUserId}>`,
      canonical: {
        homeScore: b!.canonicalHomeScore,
        awayScore: b!.canonicalAwayScore,
        decisionMethod: b!.decisionMethod,
        penaltyHome: b!.penaltyHome,
        penaltyAway: b!.penaltyAway,
        winnerEntryId: b!.declaredWinnerEntryId,
      },
    },
  );
  const components = buildConflictPanelComponents(fixture.id);
  await channel.send({ embeds: [embed], components }).catch((error) => {
    ctx.logger.warn({ error }, 'Could not post the conflict panel');
  });
}

export async function handleFixtureSelect(interaction: StringSelectMenuInteraction, ctx: AppContext): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const fixtureId = interaction.values[0];
  if (!fixtureId || fixtureId === 'none') {
    await interaction.reply({ content: 'No fixtures are currently accepting results.', ephemeral: true });
    return;
  }

  const fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new NotFoundError('Fixture');

  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  const staff = isStaffMember(member, config);

  const { home, away } = await teamNames(ctx, fixture);

  if (staff) {
    if (!isStaffOverridable(fixture.status)) {
      await interaction.reply({ content: `This fixture can't be overridden right now (status: ${fixture.status.replace(/_/g, ' ')}).`, ephemeral: true });
      return;
    }
    const modal = new ModalBuilder()
      .setCustomId(encodeCustomId(NAMESPACE, 'staff_modal', fixtureId))
      .setTitle(`${home} vs ${away}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('home_score').setLabel(`${home} score (home)`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('away_score').setLabel(`${away} score (away)`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
        ),
        ...(fixture.stage !== 'GROUP'
          ? [
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId('home_pens').setLabel('Home penalties (only if level)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId('away_pens').setLabel('Away penalties (only if level)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2),
              ),
            ]
          : []),
      );
    await interaction.showModal(modal);
    return;
  }

  let submittingEntryId: string;
  try {
    const homeEntry = await getEntryById(ctx.db, fixture.homeEntryId);
    const awayEntry = await getEntryById(ctx.db, fixture.awayEntryId);
    submittingEntryId = resolveSubmittingEntryId(
      fixture,
      [homeEntry?.managerUserId, homeEntry?.coManagerUserId].filter((id): id is string => !!id),
      [awayEntry?.managerUserId, awayEntry?.coManagerUserId].filter((id): id is string => !!id),
      interaction.user.id,
    );
  } catch (error) {
    if (error instanceof PermissionError) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
      return;
    }
    throw error;
  }

  const modal = new ModalBuilder()
    .setCustomId(encodeCustomId(NAMESPACE, 'submit_modal', fixtureId, submittingEntryId))
    .setTitle(`${home} vs ${away}`.slice(0, 45))
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('my_score').setLabel('Your score').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
      ),
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder().setCustomId('opp_score').setLabel("Opponent's score").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
      ),
      ...(fixture.stage !== 'GROUP'
        ? [
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId('my_pens').setLabel('Your penalties (only if level)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2),
            ),
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder().setCustomId('opp_pens').setLabel("Opponent's penalties (only if level)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2),
            ),
          ]
        : []),
    );
  await interaction.showModal(modal);
}

export async function handleSubmitResultModal(interaction: ModalSubmitInteraction, ctx: AppContext, fixtureId: string, submittingEntryId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new NotFoundError('Fixture');

  const myScore = parseScoreInput(interaction.fields.getTextInputValue('my_score'), 'Your score');
  const oppScore = parseScoreInput(interaction.fields.getTextInputValue('opp_score'), "Opponent's score");
  const myPens = fixture.stage !== 'GROUP' ? parseOptionalPenaltyInput(interaction.fields.getTextInputValue('my_pens'), 'Your penalties') : undefined;
  const oppPens = fixture.stage !== 'GROUP' ? parseOptionalPenaltyInput(interaction.fields.getTextInputValue('opp_pens'), "Opponent's penalties") : undefined;

  const outcome = await processManagerSubmission(ctx.db, fixture, submittingEntryId, interaction.user.id, {
    submittingEntryId,
    scoreForSubmitter: myScore,
    scoreForOpponent: oppScore,
    ...(myPens !== undefined && oppPens !== undefined ? { decisionMethod: 'PENALTIES' as const } : {}),
    ...(myPens !== undefined && { penaltyForSubmitter: myPens }),
    ...(oppPens !== undefined && { penaltyForOpponent: oppPens }),
  });

  const parent = await getFixtureParentContext(ctx.db, fixture);
  await refreshResultsPanel(ctx, interaction.guild, parent);

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId!,
    tournamentId: fixture.tournamentId,
    actorType: 'USER',
    actorDiscordId: interaction.user.id,
    action: 'fixture.submit_result',
    targetEntityType: 'fixture',
    targetEntityId: fixture.id,
    afterState: { myScore, oppScore, outcome: outcome.type },
    correlationId: newCorrelationId(),
    interactionId: interaction.id,
  });

  if (outcome.type === 'waiting_for_opponent') {
    await interaction.reply({ content: '✅ Your result is in. Waiting on the other side to confirm.', ephemeral: true });
    return;
  }
  if (outcome.type === 'resolved') {
    await interaction.reply({ content: '✅ Both sides agree — this fixture is resolved!', ephemeral: true });
    return;
  }
  await postConflictPanel(ctx, interaction.guild, parent, fixture);
  await interaction.reply({ content: '⚠️ Your submission does not match the other side\'s. Staff have been notified to resolve it.', ephemeral: true });
}

export async function handleStaffOverrideModal(interaction: ModalSubmitInteraction, ctx: AppContext, fixtureId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new NotFoundError('Fixture');

  const homeScore = parseScoreInput(interaction.fields.getTextInputValue('home_score'), 'Home score');
  const awayScore = parseScoreInput(interaction.fields.getTextInputValue('away_score'), 'Away score');
  const homePens = fixture.stage !== 'GROUP' ? parseOptionalPenaltyInput(interaction.fields.getTextInputValue('home_pens'), 'Home penalties') : undefined;
  const awayPens = fixture.stage !== 'GROUP' ? parseOptionalPenaltyInput(interaction.fields.getTextInputValue('away_pens'), 'Away penalties') : undefined;

  await processStaffOverride(ctx.db, fixture, {
    homeScore,
    awayScore,
    ...(homePens !== undefined && awayPens !== undefined ? { decisionMethod: 'PENALTIES' as const } : {}),
    ...(homePens !== undefined && { penaltyHome: homePens }),
    ...(awayPens !== undefined && { penaltyAway: awayPens }),
  });

  const parent = await getFixtureParentContext(ctx.db, fixture);
  await refreshResultsPanel(ctx, interaction.guild, parent);

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId!,
    tournamentId: fixture.tournamentId,
    actorType: 'ADMIN',
    actorDiscordId: interaction.user.id,
    action: 'fixture.staff_override',
    targetEntityType: 'fixture',
    targetEntityId: fixture.id,
    afterState: { homeScore, awayScore },
    correlationId: newCorrelationId(),
    interactionId: interaction.id,
  });

  await interaction.reply({ content: '✅ Result recorded.', ephemeral: true });
}

export async function handleConflictResolutionButton(interaction: ButtonInteraction, ctx: AppContext, fixtureId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) throw new PermissionError('Staff management only.');

  const { action } = decodeCustomId(interaction.customId);
  const fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new NotFoundError('Fixture');

  if (action === 'override') {
    const { home, away } = await teamNames(ctx, fixture);
    const modal = new ModalBuilder()
      .setCustomId(encodeCustomId(NAMESPACE, 'staff_modal', fixtureId))
      .setTitle(`Override — ${home} vs ${away}`.slice(0, 45))
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('home_score').setLabel(`${home} score (home)`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('away_score').setLabel(`${away} score (away)`.slice(0, 45)).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(2),
        ),
        ...(fixture.stage !== 'GROUP'
          ? [
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId('home_pens').setLabel('Home penalties (only if level)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2),
              ),
              new ActionRowBuilder<TextInputBuilder>().addComponents(
                new TextInputBuilder().setCustomId('away_pens').setLabel('Away penalties (only if level)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(2),
              ),
            ]
          : []),
      );
    await interaction.showModal(modal);
    return;
  }

  const submissions = await getFixtureSubmissions(ctx.db, fixture.id);
  if (submissions.length < 2) {
    await interaction.reply({ content: 'This conflict no longer has two active submissions to choose from.', ephemeral: true });
    return;
  }
  const chosen = action === 'accept_one' ? submissions[0]! : submissions[1]!;

  try {
    assertFixtureTransition(fixture.status, 'RESOLVED');
  } catch {
    await interaction.reply({ content: `This fixture is no longer in conflict (status: ${fixture.status.replace(/_/g, ' ')}).`, ephemeral: true });
    return;
  }

  let resolved;
  try {
    resolved = await resolveFixtureResult(ctx.db, fixture.id, fixture.version, {
      homeScore: chosen.canonicalHomeScore,
      awayScore: chosen.canonicalAwayScore,
      winnerEntryId: chosen.declaredWinnerEntryId,
      decisionMethod: chosen.decisionMethod ?? 'NORMAL',
      resolutionSource: 'STAFF_OVERRIDE',
    });
  } catch (error) {
    if (error instanceof StalePanelError) {
      await interaction.reply({ content: '⚠️ This fixture changed since this panel was posted.', ephemeral: true });
      return;
    }
    throw error;
  }

  const parent = await getFixtureParentContext(ctx.db, fixture);
  await refreshResultsPanel(ctx, interaction.guild, parent);

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId!,
    tournamentId: fixture.tournamentId,
    actorType: 'ADMIN',
    actorDiscordId: interaction.user.id,
    action: 'fixture.resolve_conflict',
    targetEntityType: 'fixture',
    targetEntityId: fixture.id,
    afterState: { homeScore: resolved.homeScore, awayScore: resolved.awayScore, accepted: action },
    correlationId: newCorrelationId(),
    interactionId: interaction.id,
  });

  await interaction.update({ content: `✅ Resolved: ${resolved.homeScore}-${resolved.awayScore}.`, embeds: [], components: [] });
}
