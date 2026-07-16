import {
  ChannelType,
  PermissionFlagsBits,
  type ButtonInteraction,
  type Guild,
  type CategoryChannel,
} from 'discord.js';
import { randomUUID } from 'node:crypto';
import type { AppContext } from '../../types/context.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import {
  createTicket,
  findOpenTicketForUser,
  getTicketById,
  claimTicket,
  closeTicket,
} from '../../database/repositories/ticket-repository.js';
import { isStaffMember } from '../permissions/staff.js';
import { TICKET_CATEGORY_NAME, TICKET_TYPES } from '../../config/constants.js';
import { buildTicketChannelEmbed, buildTicketChannelComponents } from '../embeds/ticket-panel.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import { NotFoundError, PermissionError, ValidationError } from '../../types/errors.js';

const CLOSE_DELETE_DELAY_MS = 5000;

function sanitizeChannelNamePart(input: string): string {
  const cleaned = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);
  return cleaned || 'user';
}

/** Finds the shared ticket category by name, or creates it — the one piece
 * of "setup" this feature ever does, and it does it to itself. Idempotent:
 * safe to call on every ticket open, never creates a duplicate. */
async function findOrCreateTicketCategory(guild: Guild): Promise<CategoryChannel> {
  const existing = guild.channels.cache.find(
    (ch): ch is CategoryChannel => ch.type === ChannelType.GuildCategory && ch.name.toLowerCase() === TICKET_CATEGORY_NAME.toLowerCase(),
  );
  if (existing) return existing;

  return guild.channels.create({
    name: TICKET_CATEGORY_NAME,
    type: ChannelType.GuildCategory,
    permissionOverwrites: [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }],
  });
}

export async function handleOpenTicketButton(interaction: ButtonInteraction, ctx: AppContext, typeId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'This only works in a server.', ephemeral: true });
    return;
  }

  const type = TICKET_TYPES.find((t) => t.id === typeId);
  if (!type) throw new ValidationError('Unknown ticket type.');

  await interaction.deferReply({ ephemeral: true });

  const existing = await findOpenTicketForUser(ctx.db, interaction.guildId, interaction.user.id);
  if (existing) {
    await interaction.followUp({ content: `You already have an open ticket: <#${existing.channelId}>.`, ephemeral: true });
    return;
  }

  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const category = await findOrCreateTicketCategory(interaction.guild);

  const ticketId = randomUUID();
  const channelName = `ticket-${sanitizeChannelNamePart(interaction.user.username)}-${ticketId.slice(0, 8)}`;

  const permissionOverwrites = [
    { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    },
    ...config.adminRoleIds.map((roleId) => ({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    })),
  ];

  const channel = await interaction.guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: `${type.label} ticket opened by ${interaction.user.tag}`,
    permissionOverwrites,
  });

  const ticket = await createTicket(ctx.db, {
    id: ticketId,
    guildId: interaction.guildId,
    channelId: channel.id,
    openedBy: interaction.user.id,
    ticketType: typeId,
  });

  await channel.send({
    content: `<@${interaction.user.id}>`,
    embeds: [buildTicketChannelEmbed(ticket, interaction.user.id)],
    components: buildTicketChannelComponents(ticket.id, false),
  });

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId,
    actorType: 'USER',
    actorDiscordId: interaction.user.id,
    action: 'ticket.open',
    targetEntityType: 'ticket',
    targetEntityId: ticket.id,
    afterState: { ticketType: typeId, channelId: channel.id },
    correlationId: newCorrelationId(),
    interactionId: interaction.id,
  });

  await interaction.followUp({ content: `✅ Ticket opened: <#${channel.id}>`, ephemeral: true });
}

export async function handleClaimTicketButton(interaction: ButtonInteraction, ctx: AppContext, ticketId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;

  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) {
    throw new PermissionError('Staff management only.');
  }

  const ticket = await getTicketById(ctx.db, ticketId);
  if (!ticket) throw new NotFoundError('Ticket');
  if (ticket.status === 'CLOSED') throw new ValidationError('This ticket is already closed.');
  if (ticket.claimedBy) {
    await interaction.reply({ content: `Already claimed by <@${ticket.claimedBy}>.`, ephemeral: true });
    return;
  }

  const updated = await claimTicket(ctx.db, ticketId, interaction.user.id);

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId,
    actorType: 'ADMIN',
    actorDiscordId: interaction.user.id,
    action: 'ticket.claim',
    targetEntityType: 'ticket',
    targetEntityId: ticketId,
    afterState: { claimedBy: interaction.user.id },
    correlationId: newCorrelationId(),
    interactionId: interaction.id,
  });

  await interaction.update({
    embeds: [buildTicketChannelEmbed(updated, ticket.openedBy)],
    components: buildTicketChannelComponents(ticketId, true),
  });
  await interaction.followUp({ content: `🙋 Claimed by <@${interaction.user.id}>.`, ephemeral: false });
}

export async function handleCloseTicketButton(interaction: ButtonInteraction, ctx: AppContext, ticketId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;

  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const ticket = await getTicketById(ctx.db, ticketId);
  if (!ticket) throw new NotFoundError('Ticket');
  if (ticket.status === 'CLOSED') {
    await interaction.reply({ content: 'This ticket is already closed.', ephemeral: true });
    return;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const isOwner = interaction.user.id === ticket.openedBy;
  if (!isOwner && !isStaffMember(member, config)) {
    throw new PermissionError('Only the ticket opener or staff can close this.');
  }

  await closeTicket(ctx.db, ticketId, interaction.user.id);

  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId,
    actorType: isOwner ? 'USER' : 'ADMIN',
    actorDiscordId: interaction.user.id,
    action: 'ticket.close',
    targetEntityType: 'ticket',
    targetEntityId: ticketId,
    correlationId: newCorrelationId(),
    interactionId: interaction.id,
  });

  await interaction.reply(`🔒 Ticket closed by <@${interaction.user.id}>. This channel will be deleted in a few seconds.`);

  const channel = interaction.channel;
  setTimeout(() => {
    if (channel && 'delete' in channel) {
      channel.delete(`Ticket ${ticketId} closed`).catch((error: unknown) => {
        ctx.logger.warn({ error, ticketId }, 'Failed to delete closed ticket channel');
      });
    }
  }, CLOSE_DELETE_DELAY_MS);
}
