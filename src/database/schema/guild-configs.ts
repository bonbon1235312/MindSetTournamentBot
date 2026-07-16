import { integer, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from './_helpers.js';

/** One row per Discord guild. Holds every configurable ID referenced by the
 * /setup flow — nothing here is hardcoded in application code.
 *
 * There are deliberately no category-cache columns here — every group and
 * every knockout round gets its own category, cached on that group's or
 * round's own row (schema/groups.ts's categoryId, schema/knockout-rounds.ts's
 * categoryId) rather than a single guild-wide one, since Discord caps a
 * category at 50 channels and a cup can run more groups/rounds than a
 * shared category would allow. */
export const guildConfigs = pgTable('guild_configs', {
  guildId: text('guild_id').primaryKey(),
  timezone: text('timezone').notNull().default('Europe/London'),

  adminRoleIds: text('admin_role_ids').array().notNull().default([]),
  premiumRoleId: text('premium_role_id'),
  participantRoleId: text('participant_role_id'),

  auditLogChannelId: text('audit_log_channel_id'),
  rulesChannelId: text('rules_channel_id'),

  /** One tournament runs at a time — a single fixed channel, not a
   * per-weekday schedule. Set via /setup or directly by staff request. */
  tournamentChannelId: text('tournament_channel_id'),

  brandingPrimaryColor: text('branding_primary_color').notNull().default('#0B1F3A'),
  brandingAccentColor: text('branding_accent_color').notNull().default('#FFC93C'),

  defaultEntryFeePence: integer('default_entry_fee_pence').notNull().default(1500),

  /** Prize-pool calculation strategy — see domain/payments/prize-pool.ts. */
  prizeCalculationMode: text('prize_calculation_mode')
    .$type<'CONFIRMED_TEAMS_TIMES_FEE' | 'FIXED_DEDUCTION' | 'PERCENTAGE_DEDUCTION' | 'FIXED_AMOUNT' | 'MANUAL'>()
    .notNull()
    .default('CONFIRMED_TEAMS_TIMES_FEE'),
  prizeCalculationValuePence: integer('prize_calculation_value_pence'),
  prizeCalculationValuePercent: integer('prize_calculation_value_percent'),

  ...timestamps(),
});

export type GuildConfig = typeof guildConfigs.$inferSelect;
export type NewGuildConfig = typeof guildConfigs.$inferInsert;
