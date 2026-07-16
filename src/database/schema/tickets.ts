import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_helpers.js';
import { guildConfigs } from './guild-configs.js';
import { ticketStatusEnum } from './enums.js';

/**
 * Support ticket system — deliberately self-provisioning (no /setup
 * required): the category and channel it needs are found-or-created by
 * name on first use, the same idempotent pattern used for tournament group
 * channels. `ticketType` is a free-text key into config/constants.ts's
 * TICKET_TYPES list rather than an enum, so adding a new ticket type never
 * requires a migration.
 */
export const tickets = pgTable('tickets', {
  id: idColumn(),
  guildId: text('guild_id')
    .notNull()
    .references(() => guildConfigs.guildId, { onDelete: 'cascade' }),
  channelId: text('channel_id').notNull(),
  openedBy: text('opened_by').notNull(),
  ticketType: text('ticket_type').notNull(),

  status: ticketStatusEnum('status').notNull().default('OPEN'),
  claimedBy: text('claimed_by'),
  closedBy: text('closed_by'),
  closedAt: timestamp('closed_at', { withTimezone: true }),

  ...timestamps(),
});

export type Ticket = typeof tickets.$inferSelect;
export type NewTicket = typeof tickets.$inferInsert;
