import { integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './_helpers.js';
import { tournaments } from './tournaments.js';
import { knockoutRoundStatusEnum, stageEnum } from './enums.js';

/** One knockout stage instance (Round of 32, Quarter-Final, ...) for a
 * tournament. `roundIndex` orders stages chronologically (0 = first
 * knockout stage played) independent of bracket size, since a tournament
 * might start straight at quarter-finals. */
export const knockoutRounds = pgTable('knockout_rounds', {
  id: idColumn(),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  stage: stageEnum('stage').notNull(),
  roundIndex: integer('round_index').notNull(),
  status: knockoutRoundStatusEnum('status').notNull().default('PENDING'),

  chatChannelId: text('chat_channel_id'),
  resultsChannelId: text('results_channel_id'),
  staffChannelId: text('staff_channel_id'),
  roleId: text('role_id'),

  graphicMessageId: text('graphic_message_id'),
  resultsPanelMessageId: text('results_panel_message_id'),

  /** Random shuffle seed/order used to produce this round's pairings, kept
   * for audit/reproducibility (section 22). */
  drawMetadata: jsonb('draw_metadata').$type<{ seed: string; order: string[] }>(),

  publishedAt: timestamp('published_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),

  version: versionColumn(),
  ...timestamps(),
});

export type KnockoutRound = typeof knockoutRounds.$inferSelect;
export type NewKnockoutRound = typeof knockoutRounds.$inferInsert;
