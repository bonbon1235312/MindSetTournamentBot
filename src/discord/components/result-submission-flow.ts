import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type Guild,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { AppContext } from '../../types/context.js';
import type { Fixture } from '../../database/schema/index.js';
import { getFixtureById, getFixturesByGroup, resolveFixtureResult, updateFixtureStatus } from '../../database/repositories/fixture-repository.js';
import { getEntryById } from '../../database/repositories/entry-repository.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import { getGroupById, updateGroupResources } from '../../database/repositories/group-repository.js';
import { getTournamentById } from '../../database/repositories/tournament-repository.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { isStaffMember } from '../permissions/staff.js';
import {
  processManagerSubmission,
  processStaffOverride,
  confirmGroupComplete,
  getFixtureParentContext,
  getFixtureSubmissions,
  resolveSubmittingEntryId,
  isStaffOverridable,
  type FixtureParentContext,
} from '../../services/result-submission-service.js';
import { renderGroupStandingsGraphic } from '../../graphics/renderers/group-standings-renderer.js';
import { recordGraphic } from '../../database/repositories/graphic-repository.js';
import { checkAndAdvancePipeline } from '../../services/knockout-trigger-service.js';
import { assertFixtureTransition, isResolvedFixtureStatus } from '../../domain/fixtures/state-machine.js';
import { buildResultsPanelEmbed, buildResultsPanelComponents, buildConflictPanelEmbed, buildConflictPanelComponents } from '../embeds/results-panel-embed.js';
import { encodeCustomId, decodeCustomId } from '../interactions/custom-id.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import { NotFoundError, PermissionError, StalePanelError, ValidationError } from '../../types/errors.js';
import { FORFEIT_WIN_SCORE, FORFEIT_LOSS_SCORE } from '../../config/constants.js';

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
  const components = await buildResultsPanelComponents(
    ctx,
    fixtures,
    parent.group
      ? {
          groupId: parent.group.id,
          allResolved: fixtures.every((f) => isResolvedFixtureStatus(f.status)),
          alreadyConfirmed: parent.group.confirmationMessageId !== null,
        }
      : undefined,
  );
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
    await interaction.reply({
      content: `**${home} vs ${away}** — pick an action:`,
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'staff_enter_score', fixtureId)).setLabel('Enter Score').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'staff_forfeit_home', fixtureId)).setLabel(`${home} Wins (Forfeit)`.slice(0, 80)).setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'staff_forfeit_away', fixtureId)).setLabel(`${away} Wins (Forfeit)`.slice(0, 80)).setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'staff_void', fixtureId)).setLabel('Void Fixture').setStyle(ButtonStyle.Danger),
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  // Fail fast so an unauthorized user gets an immediate, clear rejection
  // instead of filling out a modal only to be rejected on submit — the
  // authoritative check (untrusted-input-safe) is re-run server-side in
  // handleSubmitResultModal regardless of what happens here.
  try {
    const homeEntry = await getEntryById(ctx.db, fixture.homeEntryId);
    const awayEntry = await getEntryById(ctx.db, fixture.awayEntryId);
    resolveSubmittingEntryId(
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
    .setCustomId(encodeCustomId(NAMESPACE, 'submit_modal', fixtureId))
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

/** The 4 staff-action buttons shown after picking a fixture: enter a real
 * score (shows the same modal as before), declare a forfeit either way, or
 * void the fixture entirely. Forfeit/void resolve immediately — no modal,
 * no matching — same "staff input is authoritative" rule as a normal
 * staff score override. */
export async function handleFixtureStaffAction(interaction: ButtonInteraction, ctx: AppContext, action: string, fixtureId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) throw new PermissionError('Staff management only.');

  const fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new NotFoundError('Fixture');
  if (!isStaffOverridable(fixture.status)) {
    await interaction.reply({ content: `This fixture can't be actioned right now (status: ${fixture.status.replace(/_/g, ' ')}).`, ephemeral: true });
    return;
  }

  const { home, away } = await teamNames(ctx, fixture);

  if (action === 'staff_enter_score') {
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

  let resolution: {
    winnerEntryId: string | null;
    resolutionSource: 'FORFEIT_HOME' | 'FORFEIT_AWAY' | 'VOID';
    status: 'FORFEIT' | 'VOID';
    homeScore: number | null;
    awayScore: number | null;
  };
  let resultLabel: string;
  if (action === 'staff_forfeit_home') {
    resolution = {
      winnerEntryId: fixture.homeEntryId,
      resolutionSource: 'FORFEIT_AWAY',
      status: 'FORFEIT',
      homeScore: FORFEIT_WIN_SCORE,
      awayScore: FORFEIT_LOSS_SCORE,
    };
    resultLabel = `${home} win by forfeit (${away} forfeited).`;
  } else if (action === 'staff_forfeit_away') {
    resolution = {
      winnerEntryId: fixture.awayEntryId,
      resolutionSource: 'FORFEIT_HOME',
      status: 'FORFEIT',
      homeScore: FORFEIT_LOSS_SCORE,
      awayScore: FORFEIT_WIN_SCORE,
    };
    resultLabel = `${away} win by forfeit (${home} forfeited).`;
  } else if (action === 'staff_void') {
    resolution = { winnerEntryId: null, resolutionSource: 'VOID', status: 'VOID', homeScore: null, awayScore: null };
    resultLabel = 'Fixture voided — no winner recorded.';
  } else {
    return;
  }

  let resolved;
  try {
    resolved = await resolveFixtureResult(ctx.db, fixture.id, fixture.version, {
      homeScore: resolution.homeScore,
      awayScore: resolution.awayScore,
      decisionMethod: null,
      winnerEntryId: resolution.winnerEntryId,
      resolutionSource: resolution.resolutionSource,
      status: resolution.status,
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
  await checkAndAdvancePipeline(ctx, fixture);

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId!,
    tournamentId: fixture.tournamentId,
    actorType: 'ADMIN',
    actorDiscordId: interaction.user.id,
    action: `fixture.${action}`,
    targetEntityType: 'fixture',
    targetEntityId: fixture.id,
    afterState: { status: resolved.status, winnerEntryId: resolved.winnerEntryId },
    correlationId: newCorrelationId(),
    interactionId: interaction.id,
  });

  await interaction.reply({ content: `✅ ${resultLabel}`, ephemeral: true });
}

export async function handleSubmitResultModal(interaction: ModalSubmitInteraction, ctx: AppContext, fixtureId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new NotFoundError('Fixture');

  // Custom IDs aren't cryptographically signed (see custom-id.ts) — a
  // submittingEntryId embedded in the modal's custom_id at select-time
  // would be client-controlled data by the time this handler runs, so it
  // must never be trusted directly. Re-derive who the current user is
  // actually authorized to submit for from the database, same check
  // handleFixtureSelect already ran once before showing the modal.
  const homeEntry = await getEntryById(ctx.db, fixture.homeEntryId);
  const awayEntry = await getEntryById(ctx.db, fixture.awayEntryId);
  let submittingEntryId: string;
  try {
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
    await checkAndAdvancePipeline(ctx, fixture);
    await interaction.reply({ content: '✅ Both sides agree — this fixture is resolved!', ephemeral: true });
    return;
  }
  await postConflictPanel(ctx, interaction.guild, parent, fixture);
  await interaction.reply({ content: '⚠️ Your submission does not match the other side\'s. Staff have been notified to resolve it.', ephemeral: true });
}

export async function handleStaffOverrideModal(interaction: ModalSubmitInteraction, ctx: AppContext, fixtureId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;

  // A staff-only modal shown from handleFixtureSelect's isStaffMember gate
  // isn't itself protected — a forged submit_modal:staff_modal interaction
  // would reach this handler directly, bypassing that gate entirely. Same
  // "never trust the path that got you here" re-check as everywhere else.
  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) throw new PermissionError('Staff management only.');

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
  await checkAndAdvancePipeline(ctx, fixture);

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

  if (action === 'request_evidence') {
    try {
      assertFixtureTransition(fixture.status, 'EVIDENCE_REQUESTED');
      await updateFixtureStatus(ctx.db, fixture.id, fixture.version, 'EVIDENCE_REQUESTED');
    } catch (error) {
      if (error instanceof StalePanelError) {
        await interaction.reply({ content: '⚠️ This fixture changed since this panel was posted.', ephemeral: true });
        return;
      }
      throw error;
    }

    const parent = await getFixtureParentContext(ctx.db, fixture);
    const { home, away } = await teamNames(ctx, fixture);
    if (parent.chatChannelId) {
      const channel = await interaction.guild.channels.fetch(parent.chatChannelId).catch(() => null);
      if (channel?.isTextBased()) {
        await channel
          .send(
            `📋 **${home} vs ${away}**: your submitted results don't match. Please post screenshots proving your result here, ` +
              'or open a dispute ticket if you need staff to step in directly.',
          )
          .catch(() => {});
      }
    }

    await recordAuditEvent(ctx.db, ctx.logger, {
      guildId: interaction.guildId!,
      tournamentId: fixture.tournamentId,
      actorType: 'ADMIN',
      actorDiscordId: interaction.user.id,
      action: 'fixture.request_evidence',
      targetEntityType: 'fixture',
      targetEntityId: fixture.id,
      correlationId: newCorrelationId(),
      interactionId: interaction.id,
    });

    await interaction.reply({ content: '✅ Evidence requested — both teams have been asked to post screenshots.', ephemeral: true });
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
  await checkAndAdvancePipeline(ctx, fixture);

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

/**
 * Staff-only "this group is done" step. Validates every fixture actually
 * has a result, renders the final standings graphic, posts it (pinging the
 * group role) and pins it in the group's chat channel, and marks the group
 * confirmed so this can't be triggered twice.
 */
export async function handleConfirmGroupButton(interaction: ButtonInteraction, ctx: AppContext, groupId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) throw new PermissionError('Staff management only.');

  const group = await getGroupById(ctx.db, groupId);
  if (!group) throw new NotFoundError('Group');

  let result;
  try {
    result = await confirmGroupComplete(ctx.db, groupId);
  } catch (error) {
    if (error instanceof ValidationError) {
      await interaction.reply({ content: `❌ ${error.message}`, ephemeral: true });
      return;
    }
    throw error;
  }

  if (!group.chatChannelId) {
    await interaction.reply({ content: "This group has no chat channel to post standings in.", ephemeral: true });
    return;
  }
  const chatChannel = await interaction.guild.channels.fetch(group.chatChannelId).catch(() => null);
  if (!chatChannel?.isTextBased()) {
    await interaction.reply({ content: "This group's chat channel could not be found.", ephemeral: true });
    return;
  }

  const tournament = await getTournamentById(ctx.db, group.tournamentId);
  const graphic = await renderGroupStandingsGraphic(
    {
      tournamentName: tournament?.name ?? 'Tournament',
      groupCode: group.groupCode,
      standings: result.standings,
      qualifyingPositions: result.qualifyingPositions,
    },
    ctx.env.GRAPHICS_CACHE_DIR,
  );
  await recordGraphic(ctx.db, {
    tournamentId: group.tournamentId,
    groupId: group.id,
    graphicType: 'GROUP_STANDINGS',
    contentHash: graphic.contentHash,
    filePath: graphic.filePath,
  });

  const roleMention = group.roleId ? `<@&${group.roleId}> ` : '';
  const message = await chatChannel.send({
    content: `${roleMention}🏁 **Group ${group.groupCode}** is complete! Final standings:`,
    files: [{ attachment: graphic.buffer, name: 'group-standings.png' }],
    ...(group.roleId ? { allowedMentions: { roles: [group.roleId] } } : {}),
  });
  await message.pin().catch((error) => {
    ctx.logger.warn({ error, groupId }, 'Could not pin the standings graphic — missing Manage Messages permission');
  });

  await updateGroupResources(ctx.db, group.id, { confirmationMessageId: message.id });

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId!,
    tournamentId: group.tournamentId,
    actorType: 'ADMIN',
    actorDiscordId: interaction.user.id,
    action: 'group.confirm_complete',
    targetEntityType: 'group',
    targetEntityId: group.id,
    afterState: { standingsMessageId: message.id },
    correlationId: newCorrelationId(),
    interactionId: interaction.id,
  });

  if (group.resultsChannelId && group.resultsPanelMessageId) {
    const resultsChannel = await interaction.guild.channels.fetch(group.resultsChannelId).catch(() => null);
    if (resultsChannel?.isTextBased()) {
      const panelMsg = await resultsChannel.messages.fetch(group.resultsPanelMessageId).catch(() => null);
      if (panelMsg) {
        const fixtures = await getFixturesByGroup(ctx.db, group.id);
        const embed = await buildResultsPanelEmbed(ctx, fixtures, `Group ${group.groupCode}`);
        const components = await buildResultsPanelComponents(ctx, fixtures, { groupId: group.id, allResolved: true, alreadyConfirmed: true });
        await panelMsg.edit({ embeds: [embed], components }).catch(() => {});
      }
    }
  }

  await interaction.reply({
    content: `✅ Group ${group.groupCode} confirmed — standings posted and pinned in <#${group.chatChannelId}>.`,
    ephemeral: true,
  });
}
