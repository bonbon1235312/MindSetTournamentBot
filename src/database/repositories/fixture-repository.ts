import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { fixtures, type Fixture, type NewFixture } from '../schema/index.js';
import { assertVersionedUpdate } from '../transactions/optimistic-lock.js';
import type { DecisionMethod, ResolutionSource, FixtureStatus } from '../schema/enums.js';

export async function createFixture(db: Database, values: NewFixture): Promise<Fixture> {
  const [created] = await db.insert(fixtures).values(values).returning();
  if (!created) throw new Error('Failed to create fixture');
  return created;
}

export async function getFixtureById(db: Database, id: string): Promise<Fixture | undefined> {
  return db.query.fixtures.findFirst({ where: eq(fixtures.id, id) });
}

export async function getFixturesByGroup(db: Database, groupId: string): Promise<Fixture[]> {
  return db.query.fixtures.findMany({ where: eq(fixtures.groupId, groupId), orderBy: (f, { asc }) => [asc(f.roundNumber)] });
}

export async function getFixturesByKnockoutRound(db: Database, knockoutRoundId: string): Promise<Fixture[]> {
  return db.query.fixtures.findMany({ where: eq(fixtures.knockoutRoundId, knockoutRoundId) });
}

export async function getFixturesByTournament(db: Database, tournamentId: string): Promise<Fixture[]> {
  return db.query.fixtures.findMany({ where: eq(fixtures.tournamentId, tournamentId) });
}

/** Resolves a fixture's result. This is the one place a fixture's score
 * gets written, whether that's the (not-yet-built) dual-submission flow, a
 * staff override, or /tournament test's simulated results — all funnel
 * through here so "RESOLVED means version bumped + resolvedAt stamped"
 * never drifts between callers. */
export async function resolveFixtureResult(
  db: Database,
  id: string,
  expectedVersion: number,
  result: {
    homeScore: number;
    awayScore: number;
    winnerEntryId: string | null;
    decisionMethod: DecisionMethod;
    resolutionSource: ResolutionSource;
  },
): Promise<Fixture> {
  const [updated] = await db
    .update(fixtures)
    .set({
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      winnerEntryId: result.winnerEntryId,
      decisionMethod: result.decisionMethod,
      resolutionSource: result.resolutionSource,
      status: 'RESOLVED',
      resolvedAt: new Date(),
      version: sql`${fixtures.version} + 1`,
      updatedAt: new Date(),
    })
    .where(and(eq(fixtures.id, id), eq(fixtures.version, expectedVersion)))
    .returning();
  return assertVersionedUpdate(updated);
}

/** Plain status write — callers are responsible for validating the
 * transition first (via assertFixtureTransition), same convention as
 * updateEntryStatus/updateTournamentStatus: repositories don't
 * self-validate, the calling service/handler does. */
export async function updateFixtureStatus(
  db: Database,
  id: string,
  expectedVersion: number,
  status: FixtureStatus,
  extra?: Partial<Pick<Fixture, 'readyAt' | 'firstReminderSentAt' | 'staffAlertSentAt'>>,
): Promise<Fixture> {
  const [updated] = await db
    .update(fixtures)
    .set({ status, ...extra, version: sql`${fixtures.version} + 1`, updatedAt: new Date() })
    .where(and(eq(fixtures.id, id), eq(fixtures.version, expectedVersion)))
    .returning();
  return assertVersionedUpdate(updated);
}

/** Test-diagnostic teardown only (/tournament test) — normal tournaments
 * never delete fixtures, they stay as permanent history (section 33). */
export async function deleteFixturesByTournament(db: Database, tournamentId: string): Promise<void> {
  await db.delete(fixtures).where(eq(fixtures.tournamentId, tournamentId));
}
