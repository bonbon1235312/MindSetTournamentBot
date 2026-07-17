import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppContext } from '../../types/context.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { isStaffMember } from '../permissions/staff.js';
import { getEntryById, updatePaymentStatus, updateEntryStatus } from '../../database/repositories/entry-repository.js';
import { assertEntryTransition } from '../../domain/entries/state-machine.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import { getTournamentById } from '../../database/repositories/tournament-repository.js';
import { tournaments, tournamentEntries, type PaymentStatus } from '../../database/schema/index.js';
import { createPayment } from '../../database/repositories/payment-repository.js';
import { refreshTournamentAnnouncement } from '../../services/tournament-announcement-service.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import { PermissionError, StalePanelError, ValidationError } from '../../types/errors.js';
import { encodeCustomId, decodeCustomId } from '../interactions/custom-id.js';
import { formatPence } from '../../domain/payments/prize-pool.js';
import { DEFAULT_BRANDING } from '../../config/constants.js';

const NAMESPACE = 'payments';
const LIVE_STATUSES = [
  'PUBLISHED', 'PREMIUM_SIGNUP', 'GENERAL_SIGNUP', 'PAYMENT_LOCKED', 'SIGNUP_CLOSED',
  'GENERATING_GROUPS', 'GROUP_CONFIRMATION', 'GROUP_STAGE_LIVE', 'CALCULATING_QUALIFIERS',
  'QUALIFICATION_REVIEW', 'KNOCKOUT_LIVE', 'FINAL_LIVE',
] as const;

export const paymentsCommand = new SlashCommandBuilder()
  .setName('payments')
  .setDescription('Open the payment control panel for the current tournament (staff only)');

async function findMostRecentLiveTournament(ctx: AppContext, guildId: string) {
  return ctx.db.query.tournaments.findFirst({
    where: and(eq(tournaments.guildId, guildId), inArray(tournaments.status, [...LIVE_STATUSES])),
    orderBy: (t, { desc }) => desc(t.createdAt),
  });
}

export async function executePaymentsCommand(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) throw new PermissionError('Staff management only.');

  const tournament = await findMostRecentLiveTournament(ctx, interaction.guildId);
  if (!tournament) {
    await interaction.reply({ content: 'No live tournament found for this server.', ephemeral: true });
    return;
  }

  const rows = await buildTeamPickerRows(ctx, tournament.id);
  await interaction.reply({ content: `**${tournament.name}** — pick a team:`, components: rows, ephemeral: true });
}

export async function buildTeamPickerRows(
  ctx: AppContext,
  tournamentId: string,
): Promise<ActionRowBuilder<MessageActionRowComponentBuilder>[]> {
  const entries = await ctx.db.query.tournamentEntries.findMany({ where: eq(tournamentEntries.tournamentId, tournamentId) });
  const options = await Promise.all(
    entries.slice(0, 25).map(async (entry) => {
      const club = await getClubById(ctx.db, entry.clubId);
      return {
        label: (club?.displayName ?? 'Unknown team').slice(0, 100),
        description: `${entry.paymentStatus.replace(/_/g, ' ')} · ${entry.entryStatus.replace(/_/g, ' ')}`.slice(0, 100),
        value: entry.id,
      };
    }),
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(encodeCustomId(NAMESPACE, 'pick_team', tournamentId))
    .setPlaceholder(entries.length === 0 ? 'No entries yet' : 'Select a team');

  if (options.length > 0) select.addOptions(options);
  else select.addOptions([{ label: 'No entries yet', value: 'none' }]).setDisabled(true);

  return [new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(select)];
}

async function buildPaymentPanel(ctx: AppContext, entryId: string): Promise<{ embed: EmbedBuilder; rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] }> {
  const entry = await getEntryById(ctx.db, entryId);
  if (!entry) throw new ValidationError('That entry no longer exists.');
  const club = await getClubById(ctx.db, entry.clubId);
  const tournament = await getTournamentById(ctx.db, entry.tournamentId);

  const embed = new EmbedBuilder()
    .setColor(DEFAULT_BRANDING.primaryColor as `#${string}`)
    .setTitle(`💳 Payment Panel — ${club?.displayName ?? 'Unknown team'}`)
    .addFields(
      { name: 'Manager', value: `<@${entry.managerUserId}>`, inline: true },
      { name: 'Co-manager', value: entry.coManagerUserId ? `<@${entry.coManagerUserId}>` : '—', inline: true },
      { name: 'Signup time', value: `<t:${Math.floor(entry.signupTime.getTime() / 1000)}:f>`, inline: true },
      { name: 'Premium at signup', value: entry.premiumAtSignup ? 'Yes' : 'No', inline: true },
      { name: 'Payment state', value: entry.paymentStatus.replace(/_/g, ' '), inline: true },
      { name: 'Entry fee', value: formatPence(tournament?.entryFeePence ?? 0), inline: true },
      {
        name: 'Confirmed by',
        value: entry.paymentConfirmedBy ? `<@${entry.paymentConfirmedBy}>` : '—',
        inline: true,
      },
      {
        name: 'Confirmed at',
        value: entry.paymentConfirmedAt ? `<t:${Math.floor(entry.paymentConfirmedAt.getTime() / 1000)}:f>` : '—',
        inline: true,
      },
      { name: 'Late payment override', value: entry.latePaymentOverride ? '✅ Yes' : 'No', inline: true },
      { name: 'Entry status', value: entry.entryStatus.replace(/_/g, ' '), inline: true },
    );

  const rows = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'confirm', entryId)).setLabel('Confirm Payment').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'undo', entryId)).setLabel('Undo Confirmation').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'reject', entryId)).setLabel('Reject Payment').setStyle(ButtonStyle.Danger),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'half_refund', entryId)).setLabel('Mark Half Refund Due').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'full_refund', entryId)).setLabel('Mark Fully Refunded').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'override_deadline', entryId)).setLabel('Override Payment Deadline').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'note', entryId)).setLabel('Add Staff Note').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'disqualify', entryId))
        .setLabel('Disqualify Team')
        .setStyle(ButtonStyle.Danger)
        .setDisabled(entry.entryStatus !== 'ACTIVE'),
    ),
  ];

  return { embed, rows };
}

async function applyPaymentChange(
  ctx: AppContext,
  interaction: ButtonInteraction,
  entryId: string,
  newStatus: PaymentStatus,
  action: string,
  note?: string,
): Promise<void> {
  const entry = await getEntryById(ctx.db, entryId);
  if (!entry) throw new ValidationError('That entry no longer exists.');

  const before = { paymentStatus: entry.paymentStatus };
  const changes: Parameters<typeof updatePaymentStatus>[3] = { paymentStatus: newStatus };
  if (newStatus === 'PAYMENT_CONFIRMED') {
    changes.paymentConfirmedBy = interaction.user.id;
    changes.paymentConfirmedAt = new Date();
  }

  let updated;
  try {
    updated = await updatePaymentStatus(ctx.db, entryId, entry.version, changes);
  } catch (error) {
    if (error instanceof StalePanelError) {
      await interaction.reply({ content: '⚠️ This panel is out of date. Press Refresh.', ephemeral: true });
      return;
    }
    throw error;
  }

  await createPayment(ctx.db, {
    tournamentEntryId: entryId,
    status: newStatus,
    amountPence: (await getTournamentById(ctx.db, entry.tournamentId))?.entryFeePence ?? 0,
    staffNote: note ?? null,
    changedBy: interaction.user.id,
  });

  const correlationId = newCorrelationId();
  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId!,
    tournamentId: entry.tournamentId,
    actorType: 'ADMIN',
    actorDiscordId: interaction.user.id,
    action: `payment.${action}`,
    targetEntityType: 'tournament_entry',
    targetEntityId: entryId,
    beforeState: before,
    afterState: { paymentStatus: newStatus },
    reason: note ?? null,
    correlationId,
    interactionId: interaction.id,
  });

  await refreshTournamentAnnouncement(ctx.client, ctx.db, ctx.logger, entry.tournamentId);

  const { embed, rows } = await buildPaymentPanel(ctx, entryId);
  await interaction.update({ embeds: [embed], components: rows });
  void updated;
}

export async function handlePaymentsComponent(
  interaction: AnySelectMenuInteraction | ButtonInteraction | ModalSubmitInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) throw new PermissionError('Staff management only.');

  const { action, parts } = decodeCustomId(interaction.customId);
  const entityId = parts[0]!;

  if (action === 'pick_team' && interaction.isStringSelectMenu()) {
    if (interaction.values[0] === 'none') {
      await interaction.reply({ content: 'No entries in this tournament yet.', ephemeral: true });
      return;
    }
    const { embed, rows } = await buildPaymentPanel(ctx, interaction.values[0]!);
    await interaction.update({ content: null, embeds: [embed], components: rows });
    return;
  }

  if (action === 'note' && interaction.isButton()) {
    const modal = new ModalBuilder()
      .setCustomId(encodeCustomId(NAMESPACE, 'note_modal', entityId))
      .setTitle('Add Staff Note')
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder().setCustomId('note').setLabel('Note').setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true),
        ),
      );
    await interaction.showModal(modal);
    return;
  }

  if (action === 'note_modal' && interaction.isModalSubmit()) {
    const note = interaction.fields.getTextInputValue('note');
    const entry = await getEntryById(ctx.db, entityId);
    if (!entry) throw new ValidationError('That entry no longer exists.');
    await createPayment(ctx.db, {
      tournamentEntryId: entityId,
      status: entry.paymentStatus,
      amountPence: (await getTournamentById(ctx.db, entry.tournamentId))?.entryFeePence ?? 0,
      staffNote: note,
      changedBy: interaction.user.id,
    });
    await recordAuditEvent(ctx.db, ctx.logger, {
      guildId: interaction.guildId!,
      tournamentId: entry.tournamentId,
      actorType: 'ADMIN',
      actorDiscordId: interaction.user.id,
      action: 'payment.note',
      targetEntityType: 'tournament_entry',
      targetEntityId: entityId,
      reason: note,
      correlationId: newCorrelationId(),
      interactionId: interaction.id,
    });
    await interaction.reply({ content: '✅ Note added.', ephemeral: true });
    return;
  }

  if (!interaction.isButton()) return;

  switch (action) {
    case 'confirm':
      await applyPaymentChange(ctx, interaction, entityId, 'PAYMENT_CONFIRMED', 'confirm');
      return;
    case 'undo':
      await applyPaymentChange(ctx, interaction, entityId, 'AWAITING_PAYMENT', 'undo_confirmation');
      return;
    case 'reject':
      await applyPaymentChange(ctx, interaction, entityId, 'PAYMENT_REJECTED', 'reject');
      return;
    case 'half_refund':
      await applyPaymentChange(ctx, interaction, entityId, 'REFUND_DUE', 'half_refund');
      return;
    case 'full_refund':
      await applyPaymentChange(ctx, interaction, entityId, 'FULLY_REFUNDED', 'full_refund');
      return;
    case 'override_deadline': {
      const entry = await getEntryById(ctx.db, entityId);
      if (!entry) throw new ValidationError('That entry no longer exists.');
      await updatePaymentStatus(ctx.db, entityId, entry.version, {
        latePaymentOverride: true,
        latePaymentOverrideBy: interaction.user.id,
      });
      await recordAuditEvent(ctx.db, ctx.logger, {
        guildId: interaction.guildId!,
        tournamentId: entry.tournamentId,
        actorType: 'ADMIN',
        actorDiscordId: interaction.user.id,
        action: 'payment.override_deadline',
        targetEntityType: 'tournament_entry',
        targetEntityId: entityId,
        correlationId: newCorrelationId(),
        interactionId: interaction.id,
      });
      const { embed, rows } = await buildPaymentPanel(ctx, entityId);
      await interaction.update({ embeds: [embed], components: rows });
      return;
    }
    case 'disqualify': {
      const entry = await getEntryById(ctx.db, entityId);
      if (!entry) throw new ValidationError('That entry no longer exists.');
      const club = await getClubById(ctx.db, entry.clubId);
      await interaction.reply({
        content: `Disqualify **${club?.displayName ?? 'this team'}**? This removes them from the tournament — their remaining fixtures are NOT automatically voided or forfeited; handle those separately from the results panel if needed.`,
        components: [
          new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
            new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'disqualify_confirm', entityId)).setLabel('Yes, disqualify').setStyle(ButtonStyle.Danger),
          ),
        ],
        ephemeral: true,
      });
      return;
    }
    case 'disqualify_confirm': {
      const entry = await getEntryById(ctx.db, entityId);
      if (!entry) throw new ValidationError('That entry no longer exists.');
      assertEntryTransition(entry.entryStatus, 'DISQUALIFIED');
      await updateEntryStatus(ctx.db, entry.id, entry.version, { entryStatus: 'DISQUALIFIED' });

      await recordAuditEvent(ctx.db, ctx.logger, {
        guildId: interaction.guildId!,
        tournamentId: entry.tournamentId,
        actorType: 'ADMIN',
        actorDiscordId: interaction.user.id,
        action: 'entry.disqualify',
        targetEntityType: 'tournament_entry',
        targetEntityId: entityId,
        correlationId: newCorrelationId(),
        interactionId: interaction.id,
      });

      await interaction.update({ content: '✅ Team disqualified.', components: [] });
      return;
    }
  }
}
