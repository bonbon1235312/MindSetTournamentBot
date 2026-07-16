import { integer, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_helpers.js';
import { tournaments } from './tournaments.js';
import { groups } from './groups.js';
import { knockoutRounds } from './knockout-rounds.js';
import { graphicTypeEnum } from './enums.js';

/** Records every rendered graphic version so repeated renders of unchanged
 * data can be skipped via contentHash (section 14/25), and so Discord
 * message references can be tied back to a specific render. */
export const graphics = pgTable('graphics', {
  id: idColumn(),
  tournamentId: uuid('tournament_id')
    .notNull()
    .references(() => tournaments.id, { onDelete: 'cascade' }),
  groupId: uuid('group_id').references(() => groups.id, { onDelete: 'cascade' }),
  knockoutRoundId: uuid('knockout_round_id').references(() => knockoutRounds.id, { onDelete: 'cascade' }),

  graphicType: graphicTypeEnum('graphic_type').notNull(),
  contentHash: text('content_hash').notNull(),
  version: integer('version').notNull().default(1),
  filePath: text('file_path').notNull(),

  ...timestamps(),
});

export type Graphic = typeof graphics.$inferSelect;
export type NewGraphic = typeof graphics.$inferInsert;
