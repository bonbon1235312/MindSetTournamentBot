import { integer, pgTable, primaryKey, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { timestamps } from './_helpers.js';
import { groups } from './groups.js';
import { tournamentEntries } from './tournament-entries.js';

/** Authoritative group <-> entry join, with slot ordering for deterministic
 * fixture generation (circle method reads slots 1-4 in order). */
export const groupMemberships = pgTable(
  'group_memberships',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    tournamentEntryId: uuid('tournament_entry_id')
      .notNull()
      .references(() => tournamentEntries.id, { onDelete: 'cascade' }),
    slotNumber: integer('slot_number').notNull(),
    ...timestamps(),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.tournamentEntryId] }),
    uniqueIndex('group_memberships_slot_idx').on(table.groupId, table.slotNumber),
  ],
);

export type GroupMembership = typeof groupMemberships.$inferSelect;
export type NewGroupMembership = typeof groupMemberships.$inferInsert;
