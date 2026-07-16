import { boolean, integer, jsonb, pgTable, text } from 'drizzle-orm/pg-core';
import { idColumn, timestamps } from './_helpers.js';
import { guildConfigs } from './guild-configs.js';

export interface ScheduleTimeOfDay {
  hour: number;
  minute: number;
}

export interface TemplateSchedule {
  premiumCutoff: ScheduleTimeOfDay;
  paymentDeadline: ScheduleTimeOfDay;
  signupClose: ScheduleTimeOfDay;
  groupPublish: ScheduleTimeOfDay;
  roundOne: ScheduleTimeOfDay;
  roundTwo: ScheduleTimeOfDay;
  roundThree: ScheduleTimeOfDay;
  cleanup: ScheduleTimeOfDay;
}

/** A reusable weekly tournament shape (e.g. "Monday Top Tier Cash Cup").
 * Section 31/35 — one row per recurring slot, referenced when a tournament
 * instance is created for a specific date. */
export const tournamentTemplates = pgTable('tournament_templates', {
  id: idColumn(),
  guildId: text('guild_id')
    .notNull()
    .references(() => guildConfigs.guildId, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  weekday: text('weekday').$type<
    'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
  >(),
  channelId: text('channel_id'),

  schedule: jsonb('schedule').$type<TemplateSchedule>().notNull(),

  entryFeePence: integer('entry_fee_pence').notNull().default(1500),
  active: boolean('active').notNull().default(true),

  ...timestamps(),
});

export type TournamentTemplate = typeof tournamentTemplates.$inferSelect;
export type NewTournamentTemplate = typeof tournamentTemplates.$inferInsert;
