import { boolean, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_helpers.js';
import { guildConfigs } from './guild-configs.js';

/** A club/team identity, persisted independently of any single tournament
 * entry so bans and history can follow the team name across tournaments. */
export const clubs = pgTable(
  'clubs',
  {
    id: idColumn(),
    guildId: text('guild_id')
      .notNull()
      .references(() => guildConfigs.guildId, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    /** Lowercased, whitespace-collapsed form used for case-insensitive
     * uniqueness checks (section 7). */
    normalisedName: text('normalised_name').notNull(),
    activeBan: boolean('active_ban').notNull().default(false),
    ...timestamps(),
  },
  (table) => [uniqueIndex('clubs_guild_normalised_name_idx').on(table.guildId, table.normalisedName)],
);

export type Club = typeof clubs.$inferSelect;
export type NewClub = typeof clubs.$inferInsert;
