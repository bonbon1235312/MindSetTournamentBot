import { randomUUID } from 'node:crypto';
import { integer, timestamp, uuid } from 'drizzle-orm/pg-core';

/** UUID primary key generated in JS (no pgcrypto/uuid-ossp extension needed
 * on the target Postgres instance — important for shared Pterodactyl hosts
 * where CREATE EXTENSION may not be permitted). */
export function idColumn() {
  return uuid('id')
    .primaryKey()
    .$defaultFn(() => randomUUID());
}

export function timestamps() {
  return {
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  };
}

/** Optimistic-concurrency version column — every mutating repository method
 * that updates a versioned row must bump this and check the previous value
 * in the WHERE clause (see database/transactions/optimistic-lock.ts). */
export function versionColumn() {
  return integer('version').notNull().default(1);
}
