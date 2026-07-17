import 'dotenv/config';
import dns from 'node:dns';
import { bootstrap } from './app/bootstrap.js';
import { registerShutdownHandlers } from './app/shutdown.js';

// Prefer IPv4 when resolving hostnames (see bootstrap.cjs for the full
// rationale). bootstrap.cjs already sets this in production, but this line
// covers every other entry path — local `npm run dev` (tsx), `npm start`
// (dist), or `ts-node src/index.ts` — so a broken-IPv6 host can't hang the
// Discord gateway connection regardless of how the process was launched.
dns.setDefaultResultOrder('ipv4first');

console.log(`[MindSet boot] application entry loaded (Node ${process.version})`);

/**
 * Last-resort safety net. Every code path we control already has its own
 * try/catch (the interaction router's error boundary, the scheduler's
 * per-job try/catch, etc.) — these two handlers exist for whatever isn't
 * covered by one of those: a rejected promise nobody awaited, an error
 * thrown by a dependency outside our control, anything.
 *
 * Deliberately using console.error (synchronous, writes straight to
 * stderr) rather than the Pino logger here: Pino's pretty-print transport
 * runs in a worker thread, and if the process is already crashing, there
 * is no guarantee that thread gets to flush its buffer before the process
 * exits — which would make a real crash look like a silent one in a
 * process-manager console. This is intentionally the one place in the
 * codebase that does NOT use the structured logger, for that reason.
 */
process.on('uncaughtException', (error) => {
  console.error('FATAL: uncaughtException —', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('FATAL: unhandledRejection —', reason);
  process.exit(1);
});

async function main(): Promise<void> {
  const ctx = await bootstrap();
  registerShutdownHandlers(ctx);
}

main().catch((error: unknown) => {
  console.error('Fatal startup error:', error);
  process.exit(1);
});
