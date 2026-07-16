import type { Guild } from 'discord.js';
import type { Database } from '../database/client.js';
import type { Logger } from '../utils/logger.js';
import {
  snapshotOriginalNickname,
  getNicknameSnapshot,
  markNicknameRestored,
} from '../database/repositories/nickname-snapshot-repository.js';
import { buildTournamentNickname, type NicknameRole } from '../domain/entries/nickname.js';
import { NicknameRoleHierarchyError } from '../types/errors.js';

export interface RenameResult {
  applied: boolean;
  nickname: string;
}

/**
 * Renames a member to "Team Name M"/"Team Name CO", snapshotting their
 * original nickname first. Section 7: a role-hierarchy failure must NOT
 * fail the calling flow (signup) — callers should catch
 * NicknameRoleHierarchyError, log it, alert staff, and continue.
 */
export async function applyTournamentNickname(
  guild: Guild,
  db: Database,
  logger: Logger,
  tournamentId: string,
  userId: string,
  teamName: string,
  role: NicknameRole,
): Promise<RenameResult> {
  const member = await guild.members.fetch(userId);
  const nickname = buildTournamentNickname(teamName, role);

  await snapshotOriginalNickname(db, tournamentId, userId, member.nickname, nickname);

  try {
    await member.setNickname(nickname, `MindSet Tournament: ${role === 'MANAGER' ? 'manager' : 'co-manager'} of ${teamName}`);
    return { applied: true, nickname };
  } catch (error) {
    logger.warn({ userId, tournamentId, error }, 'Failed to rename member — likely role hierarchy');
    throw new NicknameRoleHierarchyError();
  }
}

export async function restoreOriginalNickname(
  guild: Guild,
  db: Database,
  logger: Logger,
  tournamentId: string,
  userId: string,
): Promise<void> {
  const snapshot = await getNicknameSnapshot(db, tournamentId, userId);
  if (!snapshot || snapshot.restoredAt) return;

  try {
    const member = await guild.members.fetch(userId);
    await member.setNickname(snapshot.originalNickname, 'MindSet Tournament: restoring original nickname');
  } catch (error) {
    logger.warn({ userId, tournamentId, error }, 'Failed to restore nickname — member may have left or role hierarchy blocks it');
  }
  await markNicknameRestored(db, tournamentId, userId);
}
