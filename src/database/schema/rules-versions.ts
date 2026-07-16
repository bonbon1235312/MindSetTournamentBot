import { boolean, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_helpers.js';
import { guildConfigs } from './guild-configs.js';

/** Versioned cash-cup rules text (section 29). Editing rules for future
 * tournaments must never mutate what a past entrant already accepted, so
 * this is append-only — "active" just marks which version new signups see. */
export const rulesVersions = pgTable('rules_versions', {
  id: idColumn(),
  guildId: text('guild_id')
    .notNull()
    .references(() => guildConfigs.guildId, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: text('content').notNull(),
  version: integer('version').notNull(),
  active: boolean('active').notNull().default(true),
  activeFrom: timestamp('active_from', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps(),
});

export type RulesVersion = typeof rulesVersions.$inferSelect;
export type NewRulesVersion = typeof rulesVersions.$inferInsert;
