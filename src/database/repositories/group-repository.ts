import { and, eq, sql } from 'drizzle-orm';
import type { Database } from '../client.js';
import { groups, groupMemberships, type Group, type NewGroup, type GroupMembership } from '../schema/index.js';
import { assertVersionedUpdate } from '../transactions/optimistic-lock.js';

export async function createGroup(db: Database, values: NewGroup): Promise<Group> {
  const [created] = await db.insert(groups).values(values).returning();
  if (!created) throw new Error('Failed to create group');
  return created;
}

export async function getGroupsByTournament(db: Database, tournamentId: string): Promise<Group[]> {
  return db.query.groups.findMany({ where: eq(groups.tournamentId, tournamentId) });
}

export async function getGroupById(db: Database, id: string): Promise<Group | undefined> {
  return db.query.groups.findFirst({ where: eq(groups.id, id) });
}

export async function updateGroupResources(
  db: Database,
  id: string,
  resources: Partial<Pick<Group, 'categoryId' | 'roleId' | 'chatChannelId' | 'resultsChannelId' | 'staffChannelId' | 'graphicMessageId' | 'confirmationMessageId' | 'resultsPanelMessageId'>>,
): Promise<Group> {
  const [updated] = await db.update(groups).set({ ...resources, updatedAt: new Date() }).where(eq(groups.id, id)).returning();
  if (!updated) throw new Error(`Group ${id} not found`);
  return updated;
}

export async function bumpGroupVersion(db: Database, id: string, expectedVersion: number): Promise<Group> {
  const [updated] = await db
    .update(groups)
    .set({ version: sql`${groups.version} + 1`, updatedAt: new Date() })
    .where(and(eq(groups.id, id), eq(groups.version, expectedVersion)))
    .returning();
  return assertVersionedUpdate(updated);
}

export async function addGroupMembership(db: Database, groupId: string, tournamentEntryId: string, slotNumber: number): Promise<GroupMembership> {
  const [created] = await db.insert(groupMemberships).values({ groupId, tournamentEntryId, slotNumber }).returning();
  if (!created) throw new Error('Failed to create group membership');
  return created;
}

export async function getGroupMemberships(db: Database, groupId: string): Promise<GroupMembership[]> {
  return db.query.groupMemberships.findMany({ where: eq(groupMemberships.groupId, groupId), orderBy: (m, { asc }) => [asc(m.slotNumber)] });
}
