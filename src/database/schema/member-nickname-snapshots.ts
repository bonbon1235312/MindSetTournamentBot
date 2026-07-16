import { pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_helpers.js';
import { tournaments } from './tournaments.js';

/** Stores a member's nickname BEFORE the bot renames them to "Team M" /
 * "Team CO", so midnight cleanup (or a co-manager replacement) can restore
 * it exactly. One row per (tournament, user) — renaming twice within the
 * same tournament must not overwrite the original snapshot (repository
 * upserts with DO NOTHING on the original_nickname column). */
export const memberNicknameSnapshots = pgTable(
  'member_nickname_snapshots',
  {
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    originalNickname: text('original_nickname'),
    tournamentNickname: text('tournament_nickname').notNull(),
    restoredAt: timestamp('restored_at', { withTimezone: true }),
    ...timestamps(),
  },
  (table) => [primaryKey({ columns: [table.tournamentId, table.userId] })],
);

export type MemberNicknameSnapshot = typeof memberNicknameSnapshots.$inferSelect;
export type NewMemberNicknameSnapshot = typeof memberNicknameSnapshots.$inferInsert;
