import { eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { fixtures, type Fixture, type NewFixture } from '../schema/index.js';

export async function createFixture(db: Database, values: NewFixture): Promise<Fixture> {
  const [created] = await db.insert(fixtures).values(values).returning();
  if (!created) throw new Error('Failed to create fixture');
  return created;
}

export async function getFixturesByGroup(db: Database, groupId: string): Promise<Fixture[]> {
  return db.query.fixtures.findMany({ where: eq(fixtures.groupId, groupId), orderBy: (f, { asc }) => [asc(f.roundNumber)] });
}

export async function getFixturesByTournament(db: Database, tournamentId: string): Promise<Fixture[]> {
  return db.query.fixtures.findMany({ where: eq(fixtures.tournamentId, tournamentId) });
}
