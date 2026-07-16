import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type UserSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { AppContext } from '../../types/context.js';
import { getTournamentById } from '../../database/repositories/tournament-repository.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import {
  findActiveEntryForUser,
  getEntryById,
  updateCoManager,
  updateEntryStatus,
  updatePaymentStatus,
} from '../../database/repositories/entry-repository.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import { getActiveRulesVersion } from '../../database/repositories/rules-repository.js';
import { isStaffMember } from '../permissions/staff.js';
import { applyTournamentNickname, restoreOriginalNickname } from '../../services/nickname-service.js';
import { refreshTournamentAnnouncement } from '../../services/tournament-announcement-service.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import { NicknameRoleHierarchyError, NotFoundError, PermissionError, StalePanelError, ValidationError } from '../../types/errors.js';
import { encodeCustomId } from '../interactions/custom-id.js';
import { buildTeamPickerRows } from '../commands/payments.js';
import { DEFAULT_BRANDING } from '../../config/constants.js';

const NAMESPACE = 'tournament';

export async function handleViewEntryButton(interaction: ButtonInteraction, ctx: AppContext, tournamentId: string): Promise<void> {
  const entry = await findActiveEntryForUser(ctx.db, tournamentId, interaction.user.id);
  if (!entry) {
    await interaction.reply({ content: "You don't have an entry in this tournament yet. Click Sign Up to register.", ephemeral: true });
    return;
  }
  const club = await getClubById(ctx.db, entry.clubId);

  const embed = new EmbedBuilder()
    .setColor(DEFAULT_BRANDING.primaryColor as `#${string}`)
    .setTitle(`Your entry — ${club?.displayName ?? 'Unknown team'}`)
    .addFields(
      { name: 'Manager', value: `<@${entry.managerUserId}>`, inline: true },
      { name: 'Co-manager', value: entry.coManagerUserId ? `<@${entry.coManagerUserId}>` : '—', inline: true },
      { name: 'Payment', value: entry.paymentStatus.replace(/_/g, ' '), inline: true },
      { name: 'Status', value: entry.entryStatus.replace(/_/g, ' '), inline: true },
      { name: 'Premium at signup', value: entry.premiumAtSignup ? 'Yes' : 'No', inline: true },
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export async function handleViewRulesButton(interaction: ButtonInteraction, ctx: AppContext, tournamentId: string): Promise<void> {
  const tournament = await getTournamentById(ctx.db, tournamentId);
  if (!tournament) throw new NotFoundError('Tournament');
  const rules = await getActiveRulesVersion(ctx.db, tournament.guildId);

  const embed = new EmbedBuilder().setColor(DEFAULT_BRANDING.primaryColor as `#${string}`).setTitle(rules.title).setDescription(rules.content);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export async function handleRefreshButton(interaction: ButtonInteraction, ctx: AppContext, tournamentId: string): Promise<void> {
  await refreshTournamentAnnouncement(ctx.client, ctx.db, ctx.logger, tournamentId);
  await interaction.reply({ content: '🔄 Refreshed.', ephemeral: true });
}

export async function handlePullOutButton(interaction: ButtonInteraction, ctx: AppContext, tournamentId: string): Promise<void> {
  const entry = await findActiveEntryForUser(ctx.db, tournamentId, interaction.user.id);
  if (!entry) {
    await interaction.reply({ content: "You don't have an entry in this tournament.", ephemeral: true });
    return;
  }

  const rows = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'pullout_confirm', tournamentId))
        .setLabel('Yes, withdraw my team')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
  await interaction.reply({
    content: 'Are you sure you want to withdraw? This normally creates a half-refund obligation and cannot be undone by you afterward.',
    components: rows,
    ephemeral: true,
  });
}

export async function handlePullOutConfirm(interaction: ButtonInteraction, ctx: AppContext, tournamentId: string): Promise<void> {
  const entry = await findActiveEntryForUser(ctx.db, tournamentId, interaction.user.id);
  if (!entry) {
    await interaction.reply({ content: "You don't have an entry in this tournament.", ephemeral: true });
    return;
  }

  await updateEntryStatus(ctx.db, entry.id, entry.version, { entryStatus: 'WITHDRAWN', withdrawnAt: new Date() });

  if (entry.paymentStatus === 'PAYMENT_CONFIRMED') {
    const fresh = await findActiveEntryForUser(ctx.db, tournamentId, interaction.user.id);
    if (fresh) await updatePaymentStatus(ctx.db, fresh.id, fresh.version, { paymentStatus: 'REFUND_DUE' });
  }

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId!,
    tournamentId,
    actorType: 'USER',
    actorDiscordId: interaction.user.id,
    action: 'entry.withdraw',
    targetEntityType: 'tournament_entry',
    targetEntityId: entry.id,
    correlationId: newCorrelationId(),
    interactionId: interaction.id,
  });

  await restoreOriginalNickname(interaction.guild!, ctx.db, ctx.logger, tournamentId, interaction.user.id);
  if (entry.coManagerUserId) {
    await restoreOriginalNickname(interaction.guild!, ctx.db, ctx.logger, tournamentId, entry.coManagerUserId);
  }

  await refreshTournamentAnnouncement(ctx.client, ctx.db, ctx.logger, tournamentId);
  await interaction.update({ content: '✅ Your team has been withdrawn.', components: [] });
}

export async function handleCoManagerManageButton(interaction: ButtonInteraction, ctx: AppContext, tournamentId: string): Promise<void> {
  const entry = await findActiveEntryForUser(ctx.db, tournamentId, interaction.user.id);
  if (!entry) {
    await interaction.reply({ content: "You don't have an entry in this tournament.", ephemeral: true });
    return;
  }
  if (entry.managerUserId !== interaction.user.id) {
    throw new PermissionError('Only the manager can change the co-manager.');
  }

  const rows = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(encodeCustomId('comanager_change', 'select', tournamentId, entry.id))
        .setPlaceholder('Select a new co-manager')
        .setMinValues(1)
        .setMaxValues(1),
    ),
  ];

  await interaction.reply({
    content: `Current co-manager: ${entry.coManagerUserId ? `<@${entry.coManagerUserId}>` : 'None'}\nSelect a replacement below.`,
    components: rows,
    ephemeral: true,
  });
}

/** Section 8: replacing the co-manager restores the old one's nickname,
 * renames the new one, and logs the change. Manager-only (checked by the
 * caller before this select is even shown). */
export async function handleCoManagerChangeSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
  tournamentId: string,
  entryId: string,
): Promise<void> {
  const entry = await getEntryById(ctx.db, entryId);
  if (!entry) throw new NotFoundError('Tournament entry');
  if (entry.managerUserId !== interaction.user.id) {
    throw new PermissionError('Only the manager can change the co-manager.');
  }

  const newCoManagerId = interaction.values[0]!;
  if (newCoManagerId === entry.managerUserId) {
    throw new ValidationError('The co-manager cannot be the same person as the manager.');
  }
  const conflicting = await findActiveEntryForUser(ctx.db, tournamentId, newCoManagerId);
  if (conflicting && conflicting.id !== entryId) {
    throw new ValidationError('That member is already manager or co-manager of another team in this tournament.');
  }

  const oldCoManagerId = entry.coManagerUserId;
  const club = await getClubById(ctx.db, entry.clubId);

  let updated;
  try {
    updated = await updateCoManager(ctx.db, entryId, entry.version, newCoManagerId);
  } catch (error) {
    if (error instanceof StalePanelError) {
      await interaction.reply({ content: '⚠️ This panel is out of date. Press Refresh.', ephemeral: true });
      return;
    }
    throw error;
  }

  if (oldCoManagerId) {
    await restoreOriginalNickname(interaction.guild!, ctx.db, ctx.logger, tournamentId, oldCoManagerId);
  }

  const warnings: string[] = [];
  try {
    await applyTournamentNickname(interaction.guild!, ctx.db, ctx.logger, tournamentId, newCoManagerId, club?.displayName ?? 'Team', 'CO_MANAGER');
  } catch (error) {
    if (error instanceof NicknameRoleHierarchyError) warnings.push(error.message);
    else throw error;
  }

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId!,
    tournamentId,
    actorType: 'USER',
    actorDiscordId: interaction.user.id,
    action: 'entry.comanager_change',
    targetEntityType: 'tournament_entry',
    targetEntityId: entryId,
    beforeState: { coManagerUserId: oldCoManagerId },
    afterState: { coManagerUserId: newCoManagerId },
    correlationId: newCorrelationId(),
    interactionId: interaction.id,
  });

  await refreshTournamentAnnouncement(ctx.client, ctx.db, ctx.logger, tournamentId);
  void updated;

  await interaction.update({
    content: [`✅ Co-manager updated to <@${newCoManagerId}>.`, ...warnings.map((w) => `⚠️ ${w}`)].join('\n'),
    components: [],
  });
}

export async function handleAdminButton(interaction: ButtonInteraction, ctx: AppContext, tournamentId: string): Promise<void> {
  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId!);
  const member = await interaction.guild!.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) {
    await interaction.reply({ content: 'Staff management only.', ephemeral: true });
    return;
  }

  const tournament = await getTournamentById(ctx.db, tournamentId);
  if (!tournament) throw new ValidationError('Tournament no longer exists.');

  const rows = await buildTeamPickerRows(ctx, tournamentId);
  await interaction.reply({ content: `**${tournament.name}** — payment admin panel. Pick a team:`, components: rows, ephemeral: true });
}
