import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_helpers.js';
import { tournamentEntries } from './tournament-entries.js';
import { paymentMethodEnum, paymentStatusEnum } from './enums.js';

/** Append-only ledger of every payment-status change for an entry — the
 * live status lives on tournament_entries.paymentStatus; this table is the
 * audit trail of how it got there (section 9/31). */
export const payments = pgTable('payments', {
  id: idColumn(),
  tournamentEntryId: uuid('tournament_entry_id')
    .notNull()
    .references(() => tournamentEntries.id, { onDelete: 'cascade' }),
  status: paymentStatusEnum('status').notNull(),
  amountPence: integer('amount_pence').notNull(),
  method: paymentMethodEnum('method'),
  staffNote: text('staff_note'),
  changedBy: text('changed_by').notNull(),
  changedAt: timestamp('changed_at', { withTimezone: true }).notNull().defaultNow(),
  ...timestamps(),
});

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
