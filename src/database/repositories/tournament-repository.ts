import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { tournaments, type NewTournament, type Tournament } from '../schema/index.js';
import { assertVersionedUpdate } from '../transactions/optimistic-lock.js';
import type { TournamentStatus } from '../../domain/tournaments/state-machine.js';

export async function createTournament(db: Database, values: NewTournament): Promise<Tournament> {
  const [created] = await db.insert(tournaments).values(values).returning();
  if (!created) throw new Error('Failed to create tournament');
  return created;
}

export async function getTournamentById(db: Database, id: string): Promise<Tournament | undefined> {
  return db.query.tournaments.findFirst({ where: eq(tournaments.id, id) });
}

export async function updateTournamentStatus(
  db: Database,
  id: string,
  expectedVersion: number,
  newStatus: TournamentStatus,
): Promise<Tournament> {
  const [updated] = await db
    .update(tournaments)
    .set({ status: newStatus, version: sql`${tournaments.version} + 1`, updatedAt: new Date() })
    .where(and(eq(tournaments.id, id), eq(tournaments.version, expectedVersion)))
    .returning();
  return assertVersionedUpdate(updated);
}

export async function updateTournamentAnnouncement(
  db: Database,
  id: string,
  channelId: string,
  messageId: string,
): Promise<Tournament> {
  const [updated] = await db
    .update(tournaments)
    .set({ announcementChannelId: channelId, announcementMessageId: messageId, updatedAt: new Date() })
    .where(eq(tournaments.id, id))
    .returning();
  if (!updated) throw new Error(`Tournament ${id} not found`);
  return updated;
}

export async function setTournamentPaused(
  db: Database,
  id: string,
  paused: boolean,
  reason: string | null,
): Promise<Tournament> {
  const [updated] = await db
    .update(tournaments)
    .set({ paused, pausedReason: reason, updatedAt: new Date() })
    .where(eq(tournaments.id, id))
    .returning();
  if (!updated) throw new Error(`Tournament ${id} not found`);
  return updated;
}

/** Test-diagnostic teardown only (/tournament test) — real tournaments are
 * never physically deleted (section 33: history is kept forever). Cascades
 * through tournament_entries, groups, group_memberships, and fixtures
 * automatically (all FK'd with onDelete: 'cascade' back to this table). */
export async function deleteTournament(db: Database, id: string): Promise<void> {
  await db.delete(tournaments).where(eq(tournaments.id, id));
}
