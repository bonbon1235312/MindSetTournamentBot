import { boolean, date, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './_helpers.js';
import { guildConfigs } from './guild-configs.js';
import { tournamentTemplates } from './tournament-templates.js';
import { tournamentStatusEnum } from './enums.js';

export interface PrizeConfiguration {
  mode: 'CONFIRMED_TEAMS_TIMES_FEE' | 'FIXED_DEDUCTION' | 'PERCENTAGE_DEDUCTION' | 'FIXED_AMOUNT' | 'MANUAL';
  deductionPence?: number;
  deductionPercent?: number;
  fixedAmountPence?: number;
  /** Section 9: "Display clearly when the prize pool is manually overridden." */
  manualOverridePence?: number;
  manualOverrideReason?: string;
  /** Section 9: prize split, e.g. { "1st": 70, "2nd": 30 } as percentages. */
  split?: Record<string, number>;
}

/** One concrete running (or completed/cancelled) tournament instance.
 * `status` is the authoritative state machine (section 45); `phase` is a
 * free-text, display-only annotation of where within that status the
 * tournament currently is (e.g. "Round 2 of 3") — the spec lists both
 * columns without defining a second enum for phase. */
export const tournaments = pgTable('tournaments', {
  id: idColumn(),
  guildId: text('guild_id')
    .notNull()
    .references(() => guildConfigs.guildId, { onDelete: 'cascade' }),
  templateId: uuid('template_id').references(() => tournamentTemplates.id, { onDelete: 'set null' }),

  name: text('name').notNull(),
  date: date('date').notNull(),

  status: tournamentStatusEnum('status').notNull().default('DRAFT'),
  phase: text('phase'),
  /** Staff Pause/Resume (section 26) freezes scheduler progression without
   * changing `status` — a paused tournament stays exactly where it was and
   * simply stops advancing until resumed. */
  paused: boolean('paused').notNull().default(false),
  pausedReason: text('paused_reason'),

  announcementChannelId: text('announcement_channel_id'),
  announcementMessageId: text('announcement_message_id'),

  entryFeePence: integer('entry_fee_pence').notNull(),
  prizeConfiguration: jsonb('prize_configuration').$type<PrizeConfiguration>().notNull(),

  /** Snapshot of the template's schedule at creation time, so later template
   * edits never retroactively change an in-flight tournament's timings. */
  schedule: jsonb('schedule').notNull(),

  /** No FK constraint here (would create a circular import with
   * tournament-entries.ts, which already references tournaments.id) — the
   * relationship is enforced at the service layer instead. */
  winnerEntryId: uuid('winner_entry_id'),

  version: versionColumn(),
  ...timestamps(),
});

export type Tournament = typeof tournaments.$inferSelect;
export type NewTournament = typeof tournaments.$inferInsert;
