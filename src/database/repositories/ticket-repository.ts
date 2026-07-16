import { and, eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { tickets, type Ticket, type NewTicket } from '../schema/index.js';

export async function createTicket(db: Database, values: NewTicket): Promise<Ticket> {
  const [created] = await db.insert(tickets).values(values).returning();
  if (!created) throw new Error('Failed to create ticket');
  return created;
}

/** Used to stop a member opening a second ticket while one is already
 * open — regardless of type, so "no setup" doesn't quietly become
 * "no rate limit" either. */
export async function findOpenTicketForUser(db: Database, guildId: string, userId: string): Promise<Ticket | undefined> {
  return db.query.tickets.findFirst({
    where: and(eq(tickets.guildId, guildId), eq(tickets.openedBy, userId), eq(tickets.status, 'OPEN')),
  });
}

export async function findTicketByChannelId(db: Database, channelId: string): Promise<Ticket | undefined> {
  return db.query.tickets.findFirst({ where: eq(tickets.channelId, channelId) });
}

export async function getTicketById(db: Database, id: string): Promise<Ticket | undefined> {
  return db.query.tickets.findFirst({ where: eq(tickets.id, id) });
}

export async function claimTicket(db: Database, id: string, claimedBy: string): Promise<Ticket> {
  const [updated] = await db.update(tickets).set({ claimedBy, updatedAt: new Date() }).where(eq(tickets.id, id)).returning();
  if (!updated) throw new Error(`Ticket ${id} not found`);
  return updated;
}

export async function closeTicket(db: Database, id: string, closedBy: string): Promise<Ticket> {
  const [updated] = await db
    .update(tickets)
    .set({ status: 'CLOSED', closedBy, closedAt: new Date(), updatedAt: new Date() })
    .where(eq(tickets.id, id))
    .returning();
  if (!updated) throw new Error(`Ticket ${id} not found`);
  return updated;
}
