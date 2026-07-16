import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema/index.js';
import type { Env } from '../config/env.js';

export type Database = ReturnType<typeof drizzle<typeof schema>>;

let sqlClient: postgres.Sql | undefined;
let dbInstance: Database | undefined;

/** Creates (or returns the cached) Drizzle client. A single postgres.js
 * connection pool is shared for the process lifetime; call closeDatabase()
 * during graceful shutdown. */
export function createDatabase(env: Pick<Env, 'DATABASE_URL'>): Database {
  if (dbInstance) return dbInstance;

  sqlClient = postgres(env.DATABASE_URL, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  dbInstance = drizzle(sqlClient, { schema });
  return dbInstance;
}

export async function closeDatabase(): Promise<void> {
  if (sqlClient) {
    await sqlClient.end({ timeout: 5 });
    sqlClient = undefined;
    dbInstance = undefined;
  }
}
