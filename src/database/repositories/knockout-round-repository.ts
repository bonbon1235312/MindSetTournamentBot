import { eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { knockoutRounds, type KnockoutRound, type NewKnockoutRound } from '../schema/index.js';

export async function createKnockoutRound(db: Database, values: NewKnockoutRound): Promise<KnockoutRound> {
  const [created] = await db.insert(knockoutRounds).values(values).returning();
  if (!created) throw new Error('Failed to create knockout round');
  return created;
}

export async function getKnockoutRoundById(db: Database, id: string): Promise<KnockoutRound | undefined> {
  return db.query.knockoutRounds.findFirst({ where: eq(knockoutRounds.id, id) });
}

export async function getKnockoutRoundsByTournament(db: Database, tournamentId: string): Promise<KnockoutRound[]> {
  return db.query.knockoutRounds.findMany({
    where: eq(knockoutRounds.tournamentId, tournamentId),
    orderBy: (r, { asc }) => [asc(r.roundIndex)],
  });
}

/** The most recently created round for a tournament — the one currently
 * being played, or just completed and awaiting the next draw. */
export async function getLatestKnockoutRound(db: Database, tournamentId: string): Promise<KnockoutRound | undefined> {
  return db.query.knockoutRounds.findFirst({
    where: eq(knockoutRounds.tournamentId, tournamentId),
    orderBy: (r, { desc }) => [desc(r.roundIndex)],
  });
}

export async function updateKnockoutRoundResources(
  db: Database,
  id: string,
  resources: Partial<
    Pick<
      KnockoutRound,
      | 'categoryId'
      | 'roleId'
      | 'chatChannelId'
      | 'resultsChannelId'
      | 'staffChannelId'
      | 'graphicMessageId'
      | 'resultsPanelMessageId'
      | 'status'
      | 'completedAt'
    >
  >,
): Promise<KnockoutRound> {
  const [updated] = await db.update(knockoutRounds).set({ ...resources, updatedAt: new Date() }).where(eq(knockoutRounds.id, id)).returning();
  if (!updated) throw new Error(`Knockout round ${id} not found`);
  return updated;
}
