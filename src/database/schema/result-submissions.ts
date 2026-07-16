import { boolean, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_helpers.js';
import { fixtures } from './fixtures.js';
import { tournamentEntries } from './tournament-entries.js';
import { decisionMethodEnum } from './enums.js';

/**
 * One team's submitted result for a fixture, in CANONICAL home/away
 * orientation regardless of which side submitted it (section 18). A new row
 * is inserted per revision rather than updating in place, so the full
 * submission history is always auditable; `active` marks the current one.
 */
export const resultSubmissions = pgTable('result_submissions', {
  id: idColumn(),
  fixtureId: uuid('fixture_id')
    .notNull()
    .references(() => fixtures.id, { onDelete: 'cascade' }),
  submittingEntryId: uuid('submitting_entry_id')
    .notNull()
    .references(() => tournamentEntries.id, { onDelete: 'cascade' }),
  submittingUserId: text('submitting_user_id').notNull(),

  canonicalHomeScore: integer('canonical_home_score').notNull(),
  canonicalAwayScore: integer('canonical_away_score').notNull(),
  decisionMethod: decisionMethodEnum('decision_method'),
  penaltyHome: integer('penalty_home'),
  penaltyAway: integer('penalty_away'),
  declaredWinnerEntryId: uuid('declared_winner_entry_id').references(() => tournamentEntries.id, {
    onDelete: 'set null',
  }),

  revision: integer('revision').notNull().default(1),
  submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  active: boolean('active').notNull().default(true),

  ...timestamps(),
});

export type ResultSubmission = typeof resultSubmissions.$inferSelect;
export type NewResultSubmission = typeof resultSubmissions.$inferInsert;
