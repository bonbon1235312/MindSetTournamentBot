import { and, eq, or } from 'drizzle-orm';
import type { Database } from '../client.js';
import { bans, type Ban, type NewBan } from '../schema/index.js';

/** Section 10C: a ban must target a user, a club, or both — never neither. */
export async function createBan(db: Database, values: NewBan): Promise<Ban> {
  if (!values.userId && !values.clubId) {
    throw new Error('A ban must target a user, a club, or both.');
  }
  const [created] = await db.insert(bans).values(values).returning();
  if (!created) throw new Error('Failed to create ban');
  return created;
}

export async function findActiveBan(
  db: Database,
  guildId: string,
  userId: string | undefined,
  clubId: string | undefined,
): Promise<Ban | undefined> {
  const targetConditions = [];
  if (userId) targetConditions.push(eq(bans.userId, userId));
  if (clubId) targetConditions.push(eq(bans.clubId, clubId));
  if (targetConditions.length === 0) return undefined;

  return db.query.bans.findFirst({
    where: and(eq(bans.guildId, guildId), eq(bans.active, true), or(...targetConditions)),
  });
}

export async function revokeBan(db: Database, id: string, revokedBy: string): Promise<Ban> {
  const [updated] = await db
    .update(bans)
    .set({ active: false, revokedBy, revokedAt: new Date(), updatedAt: new Date() })
    .where(eq(bans.id, id))
    .returning();
  if (!updated) throw new Error(`Ban ${id} not found`);
  return updated;
}
