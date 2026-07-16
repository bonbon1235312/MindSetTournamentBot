import { ChannelType, PermissionFlagsBits, type CategoryChannel, type Guild, type Role, type TextChannel } from 'discord.js';
import type { GuildConfig, Group, KnockoutRound } from '../database/schema/index.js';
import { STAGE_LABELS } from '../domain/knockouts/knockout-draw.js';
import type { Logger } from '../utils/logger.js';

export interface GroupDiscordResources {
  category: CategoryChannel;
  role: Role;
  chatChannel: TextChannel;
  resultsChannel: TextChannel;
  staffChannel: TextChannel;
}

export interface KnockoutRoundDiscordResources {
  category: CategoryChannel;
  role: Role;
  chatChannel: TextChannel;
  resultsChannel: TextChannel;
  staffChannel: TextChannel;
}

/** Every group gets its own category (e.g. "Group A") holding all 3 of its
 * channels, rather than sharing one guild-wide category — resolved by the
 * group's own stored categoryId first, then by name, then created. The
 * caller is responsible for persisting the returned category's ID back
 * onto the group row (via updateGroupResources), same as its role/channels. */
async function ensureGroupCategory(guild: Guild, group: Group): Promise<CategoryChannel> {
  if (group.categoryId) {
    const existing = await guild.channels.fetch(group.categoryId).catch(() => null);
    if (existing?.type === ChannelType.GuildCategory) return existing;
  }

  const name = `Group ${group.groupCode}`;
  const byName = guild.channels.cache.find(
    (ch): ch is CategoryChannel => ch.type === ChannelType.GuildCategory && ch.name === name,
  );
  return byName ?? guild.channels.create({ name, type: ChannelType.GuildCategory });
}

/**
 * Creates the per-group category + role + 3 channels (section 12),
 * idempotently: if the group already has these IDs stored (a previous
 * partial run, or the repair system re-running this), the existing
 * Discord resources are reused rather than duplicated — resolved by ID
 * first (fast path), then by name as a fallback in case the stored ID was
 * deleted out-of-band.
 */
export async function ensureGroupResources(
  guild: Guild,
  group: Group,
  config: GuildConfig,
  logger: Logger,
): Promise<GroupDiscordResources> {
  const category = await ensureGroupCategory(guild, group);

  const roleName = `Group ${group.groupCode}`;
  const role = group.roleId ? await guild.roles.fetch(group.roleId).catch(() => null) : null;
  const resolvedRole =
    role ?? guild.roles.cache.find((r) => r.name === roleName) ?? (await guild.roles.create({ name: roleName, mentionable: true }));

  const chatChannel = await ensureTextChannel(guild, `group-${group.groupCode.toLowerCase()}-chat`, category.id, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: resolvedRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ...staffOverwrites(config, true),
  ]);

  const resultsChannel = await ensureTextChannel(guild, `group-${group.groupCode.toLowerCase()}-results`, category.id, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    // Group members can view + use buttons/menus, but not post free-text —
    // section 12: "Normal members cannot send regular messages."
    { id: resolvedRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
    ...staffOverwrites(config, true),
  ]);

  const staffChannel = await ensureTextChannel(guild, `group-${group.groupCode.toLowerCase()}-staff`, category.id, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: resolvedRole.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...staffOverwrites(config, true),
  ]);

  logger.info({ groupCode: group.groupCode, categoryId: category.id, roleId: resolvedRole.id }, 'Group Discord resources ready');
  return { category, role: resolvedRole, chatChannel, resultsChannel, staffChannel };
}

/** Every knockout round gets its own category too (e.g. "Quarter Finals"),
 * same reasoning as ensureGroupCategory — resolved by the round's own
 * stored categoryId first, then by name, then created. `namePrefix` mirrors
 * GroupPublishOptions.groupCodePrefix: a diagnostic test run passes one so
 * it can never resolve (and post fake results into) a real live
 * tournament's real "Quarter Finals" category by name collision — a round's
 * stage is a fixed enum value, not a per-tournament code, so unlike groups
 * the prefix has to be threaded through as its own parameter. */
async function ensureKnockoutRoundCategory(guild: Guild, round: KnockoutRound, namePrefix: string): Promise<CategoryChannel> {
  if (round.categoryId) {
    const existing = await guild.channels.fetch(round.categoryId).catch(() => null);
    if (existing?.type === ChannelType.GuildCategory) return existing;
  }

  const name = `${namePrefix}${STAGE_LABELS[round.stage]}`;
  const byName = guild.channels.cache.find(
    (ch): ch is CategoryChannel => ch.type === ChannelType.GuildCategory && ch.name === name,
  );
  return byName ?? guild.channels.create({ name, type: ChannelType.GuildCategory });
}

/**
 * Creates a knockout round's category + role + 3 channels, idempotently —
 * same pattern as ensureGroupResources. The role is assigned to every
 * entrant still alive going into this round, granting access to the
 * round's channels; it's a fresh role per round rather than reusing the
 * group role, since not every group entrant reaches the knockout stage.
 */
export async function ensureKnockoutRoundResources(
  guild: Guild,
  round: KnockoutRound,
  config: GuildConfig,
  logger: Logger,
  namePrefix = '',
): Promise<KnockoutRoundDiscordResources> {
  const category = await ensureKnockoutRoundCategory(guild, round, namePrefix);

  const roleName = `${namePrefix}${STAGE_LABELS[round.stage]}`;
  const role = round.roleId ? await guild.roles.fetch(round.roleId).catch(() => null) : null;
  const resolvedRole =
    role ?? guild.roles.cache.find((r) => r.name === roleName) ?? (await guild.roles.create({ name: roleName, mentionable: true }));

  const slugPrefix = namePrefix ? `${namePrefix.toLowerCase().replace(/\s+/g, '-')}-` : '';
  const stageSlug = STAGE_LABELS[round.stage].toLowerCase().replace(/\s+/g, '-');
  const baseName = `${slugPrefix}${stageSlug}`;

  const chatChannel = await ensureTextChannel(guild, `${baseName}-chat`, category.id, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: resolvedRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    ...staffOverwrites(config, true),
  ]);

  const resultsChannel = await ensureTextChannel(guild, `${baseName}-results`, category.id, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: resolvedRole.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory], deny: [PermissionFlagsBits.SendMessages] },
    ...staffOverwrites(config, true),
  ]);

  const staffChannel = await ensureTextChannel(guild, `${baseName}-staff`, category.id, [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: resolvedRole.id, deny: [PermissionFlagsBits.ViewChannel] },
    ...staffOverwrites(config, true),
  ]);

  logger.info({ stage: round.stage, categoryId: category.id, roleId: resolvedRole.id }, 'Knockout round Discord resources ready');
  return { category, role: resolvedRole, chatChannel, resultsChannel, staffChannel };
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
  name: string,
  categoryId: string,
  permissionOverwrites: { id: string; allow?: bigint[]; deny?: bigint[] }[],
): Promise<TextChannel> {
  const existing = guild.channels.cache.find((ch) => ch.type === ChannelType.GuildText && ch.name === name) as TextChannel | undefined;
  if (existing) return existing;

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: categoryId,
    permissionOverwrites,
  });
}
