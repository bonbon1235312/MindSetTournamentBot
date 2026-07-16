import { integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_helpers.js';
import { tournaments } from './tournaments.js';
import { jobStatusEnum, jobTypeEnum } from './enums.js';

/**
 * Database-backed job queue (section 32). Jobs are claimed transactionally
 * via `lockedBy`/`lockedUntil` (a lease) so two bot instances can never both
 * run the same job — see services/scheduler-service.ts for the claim query.
 */
export const scheduledJobs = pgTable(
  'scheduled_jobs',
  {
    id: idColumn(),
    tournamentId: uuid('tournament_id').references(() => tournaments.id, { onDelete: 'cascade' }),
    jobType: jobTypeEnum('job_type').notNull(),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),

    status: jobStatusEnum('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),

    lockedBy: text('locked_by'),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),

    /** Prevents the same logical job from ever being enqueued twice (e.g.
     * two reminder-scheduling calls racing). */
    idempotencyKey: text('idempotency_key').notNull(),

    completedAt: timestamp('completed_at', { withTimezone: true }),
    lastError: text('last_error'),

    ...timestamps(),
  },
  (table) => [uniqueIndex('scheduled_jobs_idempotency_key_idx').on(table.idempotencyKey)],
);

export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type NewScheduledJob = typeof scheduledJobs.$inferInsert;
