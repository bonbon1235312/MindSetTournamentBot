import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { idColumn } from './_helpers.js';
import { actorTypeEnum } from './enums.js';

/** Immutable audit trail (section 30). Application code must only INSERT
 * here — never UPDATE/DELETE (enforced by convention + repository design,
 * there is deliberately no updateAuditEvent()/deleteAuditEvent() function). */
export const auditEvents = pgTable('audit_events', {
  id: idColumn(),
  guildId: text('guild_id').notNull(),
  tournamentId: text('tournament_id'),

  actorType: actorTypeEnum('actor_type').notNull(),
  actorDiscordId: text('actor_discord_id'),

  action: text('action').notNull(),
  targetEntityType: text('target_entity_type').notNull(),
  targetEntityId: text('target_entity_id').notNull(),

  beforeState: jsonb('before_state'),
  afterState: jsonb('after_state'),
  reason: text('reason'),

  timestamp: timestamp('timestamp', { withTimezone: true }).notNull().defaultNow(),
  correlationId: text('correlation_id').notNull(),
  interactionId: text('interaction_id'),
});

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;
