import { integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { timestamps } from './_helpers.js';

/** One row per Discord guild. Holds every configurable ID referenced by the
 * spec's /setup flow — nothing here is hardcoded in application code. */
export const guildConfigs = pgTable('guild_configs', {
  guildId: text('guild_id').primaryKey(),
  timezone: text('timezone').notNull().default('Europe/London'),

  adminRoleIds: text('admin_role_ids').array().notNull().default([]),
  premiumRoleId: text('premium_role_id'),
  participantRoleId: text('participant_role_id'),

  groupCategoryId: text('group_category_id'),
  knockoutCategoryId: text('knockout_category_id'),
  staffCategoryId: text('staff_category_id'),

  auditLogChannelId: text('audit_log_channel_id'),
  rulesChannelId: text('rules_channel_id'),

  /** Weekday tournament announcement channels, keyed by lowercase weekday
   * name ("monday", "tuesday", ...). Populated via /setup channel selectors. */
  tournamentChannels: jsonb('tournament_channels').$type<Record<string, string>>().notNull().default({}),

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
