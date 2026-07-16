import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type MessageActionRowComponentBuilder } from 'discord.js';
import type { GuildConfig, Ticket } from '../../database/schema/index.js';
import { TICKET_TYPES } from '../../config/constants.js';
import { encodeCustomId } from '../interactions/custom-id.js';

const NAMESPACE = 'ticket';

/** Section-14-style branded panel — posted once by staff via /ticket-panel,
 * never needs re-posting or config. Discord caps one message at 5 button
 * rows of 5 buttons each; TICKET_TYPES fits comfortably in one row and new
 * types just append to it (wraps to a second row automatically past 5). */
export function buildTicketPanelEmbed(guildConfig: GuildConfig): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(guildConfig.brandingPrimaryColor as `#${string}`)
    .setAuthor({ name: 'MindSet Tournament Bot' })
    .setTitle('🎫 Need Help?')
    .setDescription(
      'Click a button below to open a private ticket with staff. Pick the option that best matches what you need — a channel just for you and the team will be created automatically.',
    )
    .addFields({
      name: 'Ticket types',
      value: TICKET_TYPES.map((t) => `${t.emoji} **${t.label}** — ${t.description}`).join('\n'),
    })
    .setFooter({ text: 'You can only have one open ticket at a time.' });
}

export function buildTicketPanelComponents(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [];
  for (let i = 0; i < TICKET_TYPES.length; i += 5) {
    const chunk = TICKET_TYPES.slice(i, i + 5);
    rows.push(
      new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
        ...chunk.map((type) =>
          new ButtonBuilder()
            .setCustomId(encodeCustomId(NAMESPACE, 'open', type.id))
            .setLabel(type.label)
            .setEmoji(type.emoji)
            .setStyle(ButtonStyle.Primary),
        ),
      ),
    );
  }
  return rows;
}

export function buildTicketChannelEmbed(ticket: Ticket, openerId: string): EmbedBuilder {
  const type = TICKET_TYPES.find((t) => t.id === ticket.ticketType);
  return new EmbedBuilder()
    .setColor('#0B1F3A')
    .setAuthor({ name: 'MindSet Tournament Bot  ·  Ticket' })
    .setTitle(`${type?.emoji ?? '🎫'} ${type?.label ?? ticket.ticketType}`)
    .setDescription(
      `Thanks for reaching out, <@${openerId}>. Describe your issue here and a staff member will be with you shortly.`,
    )
    .setFooter({ text: `Ticket ${ticket.id.slice(0, 8)}` })
    .setTimestamp(ticket.createdAt);
}

export function buildTicketChannelComponents(ticketId: string, claimed: boolean): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'claim', ticketId))
        .setLabel(claimed ? 'Claimed' : 'Claim Ticket')
        .setEmoji('🙋')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(claimed),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'close', ticketId))
        .setLabel('Close Ticket')
        .setEmoji('🔒')
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}
