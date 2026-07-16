import { ChannelType, PermissionFlagsBits, type Guild, type Role, type TextChannel } from 'discord.js';
import type { GuildConfig, Group } from '../database/schema/index.js';
import type { Logger } from '../utils/logger.js';

export interface GroupDiscordResources {
  role: Role;
  chatChannel: TextChannel;
  resultsChannel: TextChannel;
  staffChannel: TextChannel;
}

/**
 * Creates the per-group role + 3 channels (section 12), idempotently: if
 * the group already has these IDs stored (a previous partial run, or the
 * repair system re-running this), the existing Discord resources are
 * reused rather than duplicated — resolved by ID first (fast path), then
 * by name as a fallback in case the stored ID was deleted out-of-band.
 */
export async function ensureGroupResources(
  guild: Guild,
  group: Group,
  config: GuildConfig,
  logger: Logger,
): Promise<GroupDiscordResources> {
  const roleName = `Group ${group.groupCode}`;
  const role = group.roleId ? await guild.roles.fetch(group.roleId).catch(() => null) : null;
  const resolvedRole =
    role ?? guild.roles.cache.find((r) => r.name === roleName) ?? (await guild.roles.create({ name: roleName, mentionable: true }));

  const chatChannel = await ensureTextChannel(guild, config, `group-${group.groupCode.toLowerCase()}-chat`, config.groupCategoryId, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: resolvedRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ...staffOverwrites(config, true),
  ]);

  const resultsChannel = await ensureTextChannel(guild, config, `group-${group.groupCode.toLowerCase()}-results`, config.groupCategoryId, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    // Group members can view + use buttons/menus, but not post free-text —
    // section 12: "Normal members cannot send regular messages."
    { id: resolvedRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
    ...staffOverwrites(config, true),
  ]);

  const staffChannel = await ensureTextChannel(guild, config, `group-${group.groupCode.toLowerCase()}-staff`, config.staffCategoryId, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: resolvedRole.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...staffOverwrites(config, true),
  ]);

  logger.info({ groupCode: group.groupCode, roleId: resolvedRole.id }, 'Group Discord resources ready');
  return { role: resolvedRole, chatChannel, resultsChannel, staffChannel };
}

function staffOverwrites(config: GuildConfig, allowSend: boolean) {
  return config.adminRoleIds.map((roleId) => ({
    id: roleId,
    allow: allowSend
      ? [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory]
      : [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
  }));
}

async function ensureTextChannel(
  guild: Guild,
  _config: GuildConfig,
  name: string,
  categoryId: string | null,
  permissionOverwrites: { id: string; allow?: bigint[]; deny?: bigint[] }[],
): Promise<TextChannel> {
  const existing = guild.channels.cache.find((ch) => ch.type === ChannelType.GuildText && ch.name === name) as TextChannel | undefined;
  if (existing) return existing;

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: categoryId ?? null,
    permissionOverwrites,
  });
}
