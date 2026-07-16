import 'dotenv/config';
import { bootstrap } from './app/bootstrap.js';
import { registerShutdownHandlers } from './app/shutdown.js';

async function main(): Promise<void> {
  const ctx = await bootstrap();
  registerShutdownHandlers(ctx);
}

main().catch((error: unknown) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
