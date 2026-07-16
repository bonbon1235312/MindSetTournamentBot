import { integer, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './_helpers.js';
import { tournaments } from './tournaments.js';
import { groups } from './groups.js';
import { knockoutRounds } from './knockout-rounds.js';
import { tournamentEntries } from './tournament-entries.js';
import { decisionMethodEnum, fixtureStatusEnum, resolutionSourceEnum, stageEnum } from './enums.js';

/** A single match, either a group-stage round-robin fixture or a knockout
 * tie. Exactly one of groupId/knockoutRoundId is set, matching `stage`. */
export const fixtures = pgTable('fixtures', {
  id: idColumn(),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
  knockoutRoundId: uuid('knockout_round_id').references(() => knockoutRounds.id, { onDelete: 'cascade' }),

  stage: stageEnum('stage').notNull(),
  roundNumber: integer('round_number').notNull(),

  homeEntryId: uuid('home_entry_id')
    .notNull()
    .references(() => tournamentEntries.id, { onDelete: 'cascade' }),
  awayEntryId: uuid('away_entry_id')
    .notNull()
    .references(() => tournamentEntries.id, { onDelete: 'cascade' }),

  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  readyAt: timestamp('ready_at', { withTimezone: true }),

  status: fixtureStatusEnum('status').notNull().default('SCHEDULED'),

  homeScore: integer('home_score'),
  awayScore: integer('away_score'),
  decisionMethod: decisionMethodEnum('decision_method'),
  penaltyHome: integer('penalty_home'),
  penaltyAway: integer('penalty_away'),
  winnerEntryId: uuid('winner_entry_id').references(() => tournamentEntries.id, { onDelete: 'set null' }),

  resolutionSource: resolutionSourceEnum('resolution_source'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),

  /** Set once the +30/+35 minute overdue reminder jobs have fired, so a
   * scheduler restart never double-sends them (section 19). */
  firstReminderSentAt: timestamp('first_reminder_sent_at', { withTimezone: true }),
  staffAlertSentAt: timestamp('staff_alert_sent_at', { withTimezone: true }),

  version: versionColumn(),
  ...timestamps(),
});

export type Fixture = typeof fixtures.$inferSelect;
export type NewFixture = typeof fixtures.$inferInsert;
