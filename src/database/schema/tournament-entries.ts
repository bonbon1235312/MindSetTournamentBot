import { boolean, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { idColumn, timestamps, versionColumn } from './_helpers.js';
import { tournaments } from './tournaments.js';
import { clubs } from './clubs.js';
import { groups } from './groups.js';
import { rulesVersions } from './rules-versions.js';
import { confirmationStatusEnum, entryStatusEnum, paymentStatusEnum } from './enums.js';

/**
 * A club's registration in one specific tournament. This is intentionally
 * separate from `clubs` (a persistent identity) — the same club can have
 * many entries across many tournaments, each with its own manager pairing,
 * payment state and group placement.
 *
 * "Duplicate active team name" (section 7) is enforced at the service layer
 * against OTHER active entries in the SAME tournament, not as a permanent
 * global constraint — `clubs` itself is find-or-create by normalised name
 * so bans stay attached to the identity across weeks.
 */
export const tournamentEntries = pgTable(
  'tournament_entries',
  {
    id: idColumn(),
    tournamentId: uuid('tournament_id')
      .notNull()
      .references(() => tournaments.id, { onDelete: 'cascade' }),
    clubId: uuid('club_id')
      .notNull()
      .references(() => clubs.id, { onDelete: 'restrict' }),

    managerUserId: text('manager_user_id').notNull(),
    coManagerUserId: text('co_manager_user_id'),

    premiumAtSignup: boolean('premium_at_signup').notNull().default(false),
    signupTime: timestamp('signup_time', { withTimezone: true }).notNull().defaultNow(),

    paymentStatus: paymentStatusEnum('payment_status').notNull().default('AWAITING_PAYMENT'),
    paymentConfirmedBy: text('payment_confirmed_by'),
    paymentConfirmedAt: timestamp('payment_confirmed_at', { withTimezone: true }),
    latePaymentOverride: boolean('late_payment_override').notNull().default(false),
    latePaymentOverrideBy: text('late_payment_override_by'),

    rulesVersionId: uuid('rules_version_id')
      .notNull()
      .references(() => rulesVersions.id, { onDelete: 'restrict' }),
    rulesAcceptedAt: timestamp('rules_accepted_at', { withTimezone: true }).notNull().defaultNow(),

    entryStatus: entryStatusEnum('entry_status').notNull().default('AWAITING_PAYMENT'),
    reservePosition: integer('reserve_position'),
    groupId: uuid('group_id').references(() => groups.id, { onDelete: 'set null' }),
    confirmationStatus: confirmationStatusEnum('confirmation_status').notNull().default('PENDING'),

    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    kickedAt: timestamp('kicked_at', { withTimezone: true }),
    kickReason: text('kick_reason'),

    version: versionColumn(),
    ...timestamps(),
  },
  (table) => [
    // A club cannot have two simultaneously-active entries in one tournament.
    uniqueIndex('entries_tournament_club_idx').on(table.tournamentId, table.clubId),
  ],
);

export type TournamentEntry = typeof tournamentEntries.$inferSelect;
export type NewTournamentEntry = typeof tournamentEntries.$inferInsert;
