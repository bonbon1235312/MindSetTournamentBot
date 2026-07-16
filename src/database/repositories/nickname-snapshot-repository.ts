import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { memberNicknameSnapshots } from '../schema/index.js';

/** Saves the ORIGINAL nickname exactly once per (tournament, user) — a
 * second rename within the same tournament (e.g. co-manager replaced)
 * must not overwrite the true original. */
export async function snapshotOriginalNickname(
  db: Database,
  tournamentId: string,
  userId: string,
  originalNickname: string | null,
  tournamentNickname: string,
): Promise<void> {
  const existing = await db.query.memberNicknameSnapshots.findFirst({
    where: and(eq(memberNicknameSnapshots.tournamentId, tournamentId), eq(memberNicknameSnapshots.userId, userId)),
  });
  if (existing) {
    // Already snapshotted — just record the latest tournament nickname.
    await db
      .update(memberNicknameSnapshots)
      .set({ tournamentNickname, updatedAt: new Date() })
      .where(and(eq(memberNicknameSnapshots.tournamentId, tournamentId), eq(memberNicknameSnapshots.userId, userId)));
    return;
  }

  await db.insert(memberNicknameSnapshots).values({
    tournamentId,
    userId,
    originalNickname,
    tournamentNickname,
  });
}

export async function getNicknameSnapshot(db: Database, tournamentId: string, userId: string) {
  return db.query.memberNicknameSnapshots.findFirst({
    where: and(eq(memberNicknameSnapshots.tournamentId, tournamentId), eq(memberNicknameSnapshots.userId, userId)),
  });
}

export async function markNicknameRestored(db: Database, tournamentId: string, userId: string): Promise<void> {
  await db
    .update(memberNicknameSnapshots)
    .set({ restoredAt: new Date(), updatedAt: new Date() })
    .where(and(eq(memberNicknameSnapshots.tournamentId, tournamentId), eq(memberNicknameSnapshots.userId, userId)));
}

export async function getAllSnapshotsForTournament(db: Database, tournamentId: string) {
  return db.query.memberNicknameSnapshots.findMany({
    where: eq(memberNicknameSnapshots.tournamentId, tournamentId),
  });
}
