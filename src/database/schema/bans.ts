import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_helpers.js';
import { guildConfigs } from './guild-configs.js';
import { clubs } from './clubs.js';

/**
 * Tournament ban — deliberately separate from "kick" (kicks live on
 * tournament_entries.kickedAt/kickReason and only remove a team from the
 * CURRENT tournament). A ban can target a user, a club identity, or both;
 * at least one of userId/clubId must be set (enforced in the repository —
 * see database/repositories/bans.ts).
 */
export const bans = pgTable('bans', {
  id: idColumn(),
  guildId: text('guild_id')
    .notNull()
    .references(() => guildConfigs.guildId, { onDelete: 'cascade' }),
  userId: text('user_id'),
  clubId: uuid('club_id').references(() => clubs.id, { onDelete: 'cascade' }),

  reason: text('reason').notNull(),
  issuedBy: text('issued_by').notNull(),
  startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  active: boolean('active').notNull().default(true),

  revokedBy: text('revoked_by'),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),

  ...timestamps(),
});

export type Ban = typeof bans.$inferSelect;
export type NewBan = typeof bans.$inferInsert;
