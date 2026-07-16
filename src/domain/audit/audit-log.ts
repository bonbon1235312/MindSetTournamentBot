import { randomUUID } from 'node:crypto';
import type { Database } from '../../database/client.js';
import { auditEvents } from '../../database/schema/index.js';
import type { Logger } from '../../utils/logger.js';

export type AuditActorType = 'USER' | 'ADMIN' | 'SYSTEM';

export interface RecordAuditEventInput {
  guildId: string;
  tournamentId?: string | null;
  actorType: AuditActorType;
  actorDiscordId?: string | null;
  action: string;
  targetEntityType: string;
  targetEntityId: string;
  beforeState?: unknown;
  afterState?: unknown;
  reason?: string | null;
  correlationId: string;
  interactionId?: string | null;
}

/**
 * Writes one immutable audit_events row (section 30). This is the ONLY
 * function in the codebase that should INSERT into audit_events — every
 * service that mutates tournament state must call this alongside its
 * database write, ideally in the same transaction.
 */
export async function recordAuditEvent(
  db: Database,
  logger: Logger,
  input: RecordAuditEventInput,
): Promise<void> {
  await db.insert(auditEvents).values({
    guildId: input.guildId,
    tournamentId: input.tournamentId ?? null,
    actorType: input.actorType,
    actorDiscordId: input.actorDiscordId ?? null,
    action: input.action,
    targetEntityType: input.targetEntityType,
    targetEntityId: input.targetEntityId,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    reason: input.reason ?? null,
    correlationId: input.correlationId,
    interactionId: input.interactionId ?? null,
  });

  logger.info(
    {
      guildId: input.guildId,
      tournamentId: input.tournamentId,
      action: input.action,
      targetEntityType: input.targetEntityType,
      targetEntityId: input.targetEntityId,
      correlationId: input.correlationId,
    },
    `audit: ${input.action}`,
  );
}

export function newCorrelationId(): string {
  return randomUUID();
}
