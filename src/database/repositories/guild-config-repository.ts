import { eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { guildConfigs, type GuildConfig } from '../schema/index.js';

/** Finds or creates the guild_configs row for a guild — every guild the
 * bot is in should always have exactly one row, created lazily on first
 * /setup use or first interaction. */
export async function getOrCreateGuildConfig(db: Database, guildId: string): Promise<GuildConfig> {
  const existing = await db.query.guildConfigs.findFirst({ where: eq(guildConfigs.guildId, guildId) });
  if (existing) return existing;

  const [created] = await db
    .insert(guildConfigs)
    .values({ guildId })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  // Lost an insert race — the other writer's row is now there.
  const raced = await db.query.guildConfigs.findFirst({ where: eq(guildConfigs.guildId, guildId) });
  if (!raced) throw new Error(`Failed to create or find guild_configs for ${guildId}`);
  return raced;
}

export async function updateGuildConfig(
  db: Database,
  guildId: string,
  changes: Partial<Omit<GuildConfig, 'guildId' | 'createdAt' | 'updatedAt'>>,
): Promise<GuildConfig> {
  const [updated] = await db
    .update(guildConfigs)
    .set({ ...changes, updatedAt: new Date() })
    .where(eq(guildConfigs.guildId, guildId))
    .returning();

  if (!updated) throw new Error(`guild_configs row for ${guildId} not found`);
  return updated;
}

export interface GuildConfigStatus {
  configured: boolean;
  missing: string[];
}

/**
 * "/setup status command showing missing configuration." Group/knockout/
 * staff categories are deliberately NOT checked here — the bot creates
 * those itself on demand (see discord-resource-service.ts), staff never
 * need to link them.
 */
export function checkGuildConfigStatus(config: GuildConfig): GuildConfigStatus {
  const missing: string[] = [];

  if (config.adminRoleIds.length === 0) missing.push('Admin role(s)');
  if (!config.rulesChannelId) missing.push('Rules channel');
  if (!config.auditLogChannelId) missing.push('Audit log channel');
  if (!config.tournamentChannelId) missing.push('Tournament sign-up channel');

  return { configured: missing.length === 0, missing };
}
