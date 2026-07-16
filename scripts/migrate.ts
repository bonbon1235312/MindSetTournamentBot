import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL is not set — cannot run migrations.');
    process.exit(1);
  }

  const sql = postgres(databaseUrl, { max: 1 });
  const db = drizzle(sql);

  console.log('Running migrations...');
  await migrate(db, { migrationsFolder: './src/database/migrations' });
  console.log('Migrations complete.');

  await sql.end();
}

main().catch((error: unknown) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
