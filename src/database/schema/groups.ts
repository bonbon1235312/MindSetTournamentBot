import { integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './_helpers.js';
import { tournaments } from './tournaments.js';

/** One four-team group (section 11/12). group_code is "A", "B", ... "Z",
 * then "AA", "AB", ... per spec's overflow rule. */
export const groups = pgTable(
  'groups',
  {
    id: idColumn(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    groupCode: text('group_code').notNull(),

    roleId: text('role_id'),
    chatChannelId: text('chat_channel_id'),
    resultsChannelId: text('results_channel_id'),
    staffChannelId: text('staff_channel_id'),

    graphicMessageId: text('graphic_message_id'),
    confirmationMessageId: text('confirmation_message_id'),
    resultsPanelMessageId: text('results_panel_message_id'),

    /** How many of this group's teams qualify automatically (normally 2,
     * section 20 allows top-3 configurations for unusual formats). */
    qualificationSlots: integer('qualification_slots').notNull().default(2),

    version: versionColumn(),
    ...timestamps(),
  },
  (table) => [uniqueIndex('groups_tournament_code_idx').on(table.tournamentId, table.groupCode)],
);

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
