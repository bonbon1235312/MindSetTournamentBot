import { CO_MANAGER_SUFFIX, MANAGER_SUFFIX, NICKNAME_MAX_LENGTH } from '../../config/constants.js';

export type NicknameRole = 'MANAGER' | 'CO_MANAGER';

/**
 * Builds "Team Name M" / "Team Name CO", safely shortening the team-name
 * portion so the suffix always stays visible even against Discord's 32-char
 * nickname limit (section 7). Never truncates the suffix itself.
 */
export function buildTournamentNickname(teamName: string, role: NicknameRole): string {
  const suffix = role === 'MANAGER' ? MANAGER_SUFFIX : CO_MANAGER_SUFFIX;
  const maxNameLength = NICKNAME_MAX_LENGTH - suffix.length;

  const trimmedName = teamName.length > maxNameLength ? teamName.slice(0, maxNameLength).trimEnd() : teamName;

  return `${trimmedName}${suffix}`;
}
