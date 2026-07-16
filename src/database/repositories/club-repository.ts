import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { clubs, type Club } from '../schema/index.js';

/** Find-or-create by (guild, normalisedName) — see clubs.ts's comment for
 * why this is a reusable identity rather than a per-tournament record. */
export async function findOrCreateClub(
  db: Database,
  guildId: string,
  displayName: string,
  normalisedName: string,
): Promise<Club> {
  const existing = await db.query.clubs.findFirst({
    where: and(eq(clubs.guildId, guildId), eq(clubs.normalisedName, normalisedName)),
  });
  if (existing) return existing;

  const [created] = await db
    .insert(clubs)
    .values({ guildId, displayName, normalisedName })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const raced = await db.query.clubs.findFirst({
    where: and(eq(clubs.guildId, guildId), eq(clubs.normalisedName, normalisedName)),
  });
  if (!raced) throw new Error(`Failed to create or find club "${displayName}"`);
  return raced;
}

export async function getClubById(db: Database, id: string): Promise<Club | undefined> {
  return db.query.clubs.findFirst({ where: eq(clubs.id, id) });
}
