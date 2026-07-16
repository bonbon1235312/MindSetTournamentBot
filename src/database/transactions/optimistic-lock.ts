import { StalePanelError } from '../../types/errors.js';

/**
 * Shared optimistic-concurrency pattern (section 26/37): every mutating
 * update against a versioned table must include `AND version = $expected`
 * in its WHERE clause and bump `version` in the SET clause. If the update
 * affects zero rows, someone else changed the row first — surface that as
 * a StalePanelError so the caller can prompt the user to press Refresh
 * rather than silently clobbering newer state.
 *
 * Usage (inside a repository method):
 *
 *   const [updated] = await db.update(table)
 *     .set({ ...changes, version: sql`${table.version} + 1` })
 *     .where(and(eq(table.id, id), eq(table.version, expectedVersion)))
 *     .returning();
 *   return assertVersionedUpdate(updated);
 */
export function assertVersionedUpdate<T>(updatedRow: T | undefined): T {
  if (!updatedRow) {
    throw new StalePanelError();
  }
  return updatedRow;
}
