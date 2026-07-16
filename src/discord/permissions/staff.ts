import type { GuildMember } from 'discord.js';
import type { GuildConfig } from '../../database/schema/index.js';

/** True if the member holds any of the guild's configured admin roles, OR
 * the Discord "Administrator" permission (so server owners always retain
 * access even before /setup is run). Every staff-only interaction must
 * check this server-side — never trust button/component visibility. */
export function isStaffMember(member: GuildMember, config: GuildConfig): boolean {
  if (member.permissions.has('Administrator')) return true;
  if (config.adminRoleIds.length === 0) return false;
  return member.roles.cache.some((role) => config.adminRoleIds.includes(role.id));
}
