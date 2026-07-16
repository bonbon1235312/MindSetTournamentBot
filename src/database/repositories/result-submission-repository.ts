import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { resultSubmissions, type ResultSubmission, type NewResultSubmission } from '../schema/index.js';

export async function createResultSubmission(db: Database, values: NewResultSubmission): Promise<ResultSubmission> {
  const [created] = await db.insert(resultSubmissions).values(values).returning();
  if (!created) throw new Error('Failed to create result submission');
  return created;
}

/** Every currently-active submission for a fixture — at most one per side
 * (0, 1, or 2 rows), since a resubmission deactivates its predecessor. */
export async function getActiveSubmissionsForFixture(db: Database, fixtureId: string): Promise<ResultSubmission[]> {
  return db.query.resultSubmissions.findMany({
    where: and(eq(resultSubmissions.fixtureId, fixtureId), eq(resultSubmissions.active, true)),
  });
}

export async function getActiveSubmissionForEntry(
  db: Database,
  fixtureId: string,
  submittingEntryId: string,
): Promise<ResultSubmission | undefined> {
  return db.query.resultSubmissions.findFirst({
    where: and(
      eq(resultSubmissions.fixtureId, fixtureId),
      eq(resultSubmissions.submittingEntryId, submittingEntryId),
      eq(resultSubmissions.active, true),
    ),
  });
}

export async function deactivateSubmission(db: Database, id: string): Promise<void> {
  await db.update(resultSubmissions).set({ active: false, updatedAt: new Date() }).where(eq(resultSubmissions.id, id));
}
