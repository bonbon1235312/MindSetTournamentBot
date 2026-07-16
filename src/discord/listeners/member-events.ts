import {
  ChannelType,
  EmbedBuilder,
  Events,
  type Client,
  type Guild,
  type GuildMember,
  type PartialGuildMember,
  type TextChannel,
} from 'discord.js';
import type { AppContext } from '../../types/context.js';
import { DEFAULT_BRANDING, WELCOME_CHANNEL_NAME_FRAGMENT } from '../../config/constants.js';

/**
 * No dedicated "goodbye channel" exists in the mapped server layout, and
 * this feature is deliberately "no setup" like the ticket system — so both
 * join and leave messages auto-detect the same channel by a name-fragment
 * search rather than requiring a guild_configs entry. If staff ever rename
 * the welcome channel to something that doesn't contain "welcome", these
 * listeners log a warning and skip posting rather than guessing wrong.
 */
function findWelcomeChannel(guild: Guild): TextChannel | undefined {
  return guild.channels.cache.find(
    (ch): ch is TextChannel => ch.type === ChannelType.GuildText && ch.name.toLowerCase().includes(WELCOME_CHANNEL_NAME_FRAGMENT),
  );
}

export function registerMemberEventListeners(client: Client, ctx: AppContext): void {
  client.on(Events.GuildMemberAdd, (member) => {
    void handleMemberJoin(member, ctx);
  });
  client.on(Events.GuildMemberRemove, (member) => {
    void handleMemberLeave(member, ctx);
  });
}

async function handleMemberJoin(member: GuildMember, ctx: AppContext): Promise<void> {
  const channel = findWelcomeChannel(member.guild);
  if (!channel) {
    ctx.logger.warn({ guildId: member.guild.id }, 'No welcome channel found (name must contain "welcome") — skipping welcome message');
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(DEFAULT_BRANDING.primaryColor)
    .setAuthor({ name: `Welcome to ${member.guild.name}`, iconURL: member.displayAvatarURL() })
    .setDescription(`${member} just joined. Glad to have you here!`)
    .setThumbnail(member.displayAvatarURL())
    .setFooter({ text: `Member #${member.guild.memberCount}` })
    .setTimestamp(new Date());

  try {
    await channel.send({ embeds: [embed] });
  } catch (error) {
    ctx.logger.error({ error, guildId: member.guild.id, userId: member.id }, 'Failed to post welcome message');
  }
}

async function handleMemberLeave(member: GuildMember | PartialGuildMember, ctx: AppContext): Promise<void> {
  const channel = findWelcomeChannel(member.guild);
  if (!channel) return; // already logged on join failures; avoid duplicate noise on every leave too

  const joinedAt = member.joinedAt;
  const tenure = joinedAt ? formatTenure(Date.now() - joinedAt.getTime()) : 'unknown';

  const embed = new EmbedBuilder()
    .setColor(DEFAULT_BRANDING.dangerColor)
    .setAuthor({ name: `${member.user?.tag ?? 'A member'} has left`, iconURL: member.displayAvatarURL() })
    .setDescription(`**${member.user?.tag ?? 'A member'}** has left ${member.guild.name}.`)
    .addFields({ name: 'Member since', value: tenure, inline: true }, { name: 'Members remaining', value: String(member.guild.memberCount), inline: true })
    .setTimestamp(new Date());

  try {
    await channel.send({ embeds: [embed] });
  } catch (error) {
    ctx.logger.error({ error, guildId: member.guild.id, userId: member.id }, 'Failed to post goodbye message');
  }
}

function formatTenure(ms: number): string {
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days < 1) return 'less than a day';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1 month' : `${months} months`;
}
