import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { tournamentEntries, type NewTournamentEntry, type TournamentEntry } from '../schema/index.js';
import { ACTIVE_ENTRY_STATUSES } from '../../domain/entries/state-machine.js';
import { assertVersionedUpdate } from '../transactions/optimistic-lock.js';

export async function createEntry(db: Database, values: NewTournamentEntry): Promise<TournamentEntry> {
  const [created] = await db.insert(tournamentEntries).values(values).returning();
  if (!created) throw new Error('Failed to create tournament entry');
  return created;
}

export async function getEntryById(db: Database, id: string): Promise<TournamentEntry | undefined> {
  return db.query.tournamentEntries.findFirst({ where: eq(tournamentEntries.id, id) });
}

export async function getEntriesByTournament(db: Database, tournamentId: string): Promise<TournamentEntry[]> {
  return db.query.tournamentEntries.findMany({ where: eq(tournamentEntries.tournamentId, tournamentId) });
}

/** Section 7: a person cannot be manager/co-manager of more than one active
 * entry in the same tournament, in any combination. */
export async function findActiveEntryForUser(
  db: Database,
  tournamentId: string,
  userId: string,
): Promise<TournamentEntry | undefined> {
  return db.query.tournamentEntries.findFirst({
    where: and(
      eq(tournamentEntries.tournamentId, tournamentId),
      inArray(tournamentEntries.entryStatus, [...ACTIVE_ENTRY_STATUSES]),
      or(eq(tournamentEntries.managerUserId, userId), eq(tournamentEntries.coManagerUserId, userId)),
    ),
  });
}

export async function findActiveEntryByClubId(
  db: Database,
  tournamentId: string,
  clubId: string,
): Promise<TournamentEntry | undefined> {
  return db.query.tournamentEntries.findFirst({
    where: and(
      eq(tournamentEntries.tournamentId, tournamentId),
      eq(tournamentEntries.clubId, clubId),
      inArray(tournamentEntries.entryStatus, [...ACTIVE_ENTRY_STATUSES]),
    ),
  });
}

export async function updateEntryStatus(
  db: Database,
  id: string,
  expectedVersion: number,
  changes: Partial<
    Pick<
      TournamentEntry,
      'entryStatus' | 'withdrawnAt' | 'kickedAt' | 'kickReason' | 'reservePosition' | 'groupId' | 'confirmationStatus'
    >
  >,
): Promise<TournamentEntry> {
  const [updated] = await db
    .update(tournamentEntries)
    .set({ ...changes, version: sql`${tournamentEntries.version} + 1`, updatedAt: new Date() })
    .where(and(eq(tournamentEntries.id, id), eq(tournamentEntries.version, expectedVersion)))
    .returning();
  return assertVersionedUpdate(updated);
}

export async function updatePaymentStatus(
  db: Database,
  id: string,
  expectedVersion: number,
  changes: Partial<
    Pick<TournamentEntry, 'paymentStatus' | 'paymentConfirmedBy' | 'paymentConfirmedAt' | 'latePaymentOverride' | 'latePaymentOverrideBy'>
  >,
): Promise<TournamentEntry> {
  const [updated] = await db
    .update(tournamentEntries)
    .set({ ...changes, version: sql`${tournamentEntries.version} + 1`, updatedAt: new Date() })
    .where(and(eq(tournamentEntries.id, id), eq(tournamentEntries.version, expectedVersion)))
    .returning();
  return assertVersionedUpdate(updated);
}

export async function updateCoManager(
  db: Database,
  id: string,
  expectedVersion: number,
  coManagerUserId: string | null,
): Promise<TournamentEntry> {
  const [updated] = await db
    .update(tournamentEntries)
    .set({ coManagerUserId, version: sql`${tournamentEntries.version} + 1`, updatedAt: new Date() })
    .where(and(eq(tournamentEntries.id, id), eq(tournamentEntries.version, expectedVersion)))
    .returning();
  return assertVersionedUpdate(updated);
}
