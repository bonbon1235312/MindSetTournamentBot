import { inArray, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { scheduledJobs, type ScheduledJob, type NewScheduledJob } from '../schema/index.js';

const LEASE_DURATION_SQL = sql`interval '2 minutes'`;

export async function enqueueJob(db: Database, job: NewScheduledJob): Promise<ScheduledJob | undefined> {
  const [inserted] = await db
    .insert(scheduledJobs)
    .values(job)
    .onConflictDoNothing({ target: scheduledJobs.idempotencyKey })
    .returning();
  return inserted;
}

/**
 * Transactionally claims up to `limit` due jobs using `FOR UPDATE SKIP
 * LOCKED` (section 32/37) — the standard Postgres job-queue pattern. Two
 * worker processes running this concurrently can NEVER claim the same row:
 * whichever transaction locks a row first wins it, the other silently
 * skips to the next available row instead of blocking or double-claiming.
 *
 * The claim itself must be raw SQL (Drizzle's query builder can't express
 * `FOR UPDATE SKIP LOCKED` inside a CTE), but raw `db.execute()` rows come
 * back with the driver's native snake_case column names (e.g. `max_attempts`),
 * not the camelCase Drizzle schema types (`maxAttempts`) — casting that
 * result straight to `ScheduledJob` silently produces `undefined` fields.
 * So the claim only returns the winning IDs, then a normal typed
 * `db.query` re-fetch gets properly mapped camelCase rows.
 */
export async function claimDueJobs(db: Database, workerId: string, limit: number): Promise<ScheduledJob[]> {
  const claimed = await db.execute<{ id: string }>(sql`
    WITH claimable AS (
      SELECT id FROM ${scheduledJobs}
      WHERE status = 'PENDING' AND run_at <= now()
      ORDER BY run_at ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE ${scheduledJobs}
    SET status = 'RUNNING', locked_by = ${workerId}, locked_until = now() + ${LEASE_DURATION_SQL},
        attempts = attempts + 1, updated_at = now()
    WHERE id IN (SELECT id FROM claimable)
    RETURNING id;
  `);

  const claimedIds = [...claimed].map((row) => row.id);
  if (claimedIds.length === 0) return [];

  return db.query.scheduledJobs.findMany({ where: inArray(scheduledJobs.id, claimedIds) });
}

export async function completeJob(db: Database, jobId: string): Promise<void> {
  await db.execute(sql`
    UPDATE ${scheduledJobs}
    SET status = 'COMPLETED', completed_at = now(), updated_at = now()
    WHERE id = ${jobId};
  `);
}

/** Bounded exponential backoff, capped at 5 minutes, per section 32:
 * "Failed jobs retry with bounded backoff." */
export function computeBackoffSeconds(attempts: number): number {
  return Math.min(300, 2 ** attempts * 5);
}

export async function failJob(db: Database, job: ScheduledJob, errorMessage: string): Promise<'RETRY' | 'DEAD_LETTER'> {
  if (job.attempts >= job.maxAttempts) {
    await db.execute(sql`
      UPDATE ${scheduledJobs}
      SET status = 'DEAD_LETTER', last_error = ${errorMessage}, updated_at = now()
      WHERE id = ${job.id};
    `);
    return 'DEAD_LETTER';
  }

  const backoffSeconds = computeBackoffSeconds(job.attempts);
  await db.execute(sql`
    UPDATE ${scheduledJobs}
    SET status = 'PENDING', run_at = now() + (${backoffSeconds} || ' seconds')::interval,
        last_error = ${errorMessage}, locked_by = NULL, locked_until = NULL, updated_at = now()
    WHERE id = ${job.id};
  `);
  return 'RETRY';
}

/** Section 32: "On startup, reconcile overdue jobs" — resets any job left
 * RUNNING with an expired lease (its worker crashed mid-execution) back to
 * PENDING so it gets picked up again instead of being stuck forever. */
export async function reconcileOverdueJobs(db: Database): Promise<number> {
  const result = await db.execute(sql`
    UPDATE ${scheduledJobs}
    SET status = 'PENDING', locked_by = NULL, locked_until = NULL, updated_at = now()
    WHERE status = 'RUNNING' AND locked_until < now()
    RETURNING id;
  `);
  return [...result].length;
}
