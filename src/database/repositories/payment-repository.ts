import { eq } from 'drizzle-orm';
import type { Database } from '../client.js';
import { payments, type Payment, type NewPayment } from '../schema/index.js';

export async function createPayment(db: Database, values: NewPayment): Promise<Payment> {
  const [created] = await db.insert(payments).values(values).returning();
  if (!created) throw new Error('Failed to create payment record');
  return created;
}

export async function getPaymentsByEntry(db: Database, tournamentEntryId: string): Promise<Payment[]> {
  return db.query.payments.findMany({
    where: eq(payments.tournamentEntryId, tournamentEntryId),
    orderBy: (p, { desc }) => [desc(p.changedAt)],
  });
}
