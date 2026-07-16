import { ChannelType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { AppContext } from '../../types/context.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { isStaffMember } from '../permissions/staff.js';
import { PermissionError, ValidationError } from '../../types/errors.js';
import { buildTicketPanelEmbed, buildTicketPanelComponents } from '../embeds/ticket-panel.js';

/**
 * The only "setup" the ticket system ever needs: staff run this once,
 * wherever they want the panel. Everything else (category, per-ticket
 * channels, permissions) is created on demand the first time it's needed.
 */
export const ticketCommand = new SlashCommandBuilder()
  .setName('ticket-panel')
  .setDescription('Post the ticket panel here (staff only)')
  .addChannelOption((opt) =>
    opt
      .setName('channel')
      .setDescription('Channel to post the panel in (defaults to the current channel)')
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(false),
  );

export async function executeTicketCommand(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) {
    throw new PermissionError('Staff management only.');
  }

  const targetId = interaction.options.getChannel('channel')?.id ?? interaction.channelId;
  const channel = await interaction.guild.channels.fetch(targetId);
  if (!channel?.isTextBased()) {
    throw new ValidationError('Pick a text channel for the ticket panel.');
  }

  await channel.send({ embeds: [buildTicketPanelEmbed(config)], components: buildTicketPanelComponents() });
  await interaction.reply({ content: `✅ Ticket panel posted in <#${channel.id}>.`, ephemeral: true });
}
