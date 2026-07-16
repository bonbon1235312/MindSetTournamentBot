import type { AppContext } from '../types/context.js';
import { closeDatabase } from '../database/client.js';

let shuttingDown = false;

/** Section 43: graceful shutdown — stop accepting new work, close the
 * Discord connection, close the database pool, flush logs, then exit. */
export function registerShutdownHandlers(ctx: AppContext): void {
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    ctx.logger.info({ signal }, 'Shutting down...');

    ctx.scheduler.stop();
    ctx.logger.info('Scheduler stopped accepting new work.');

    try {
      ctx.client.destroy();
      ctx.logger.info('Discord client destroyed.');
    } catch (error) {
      ctx.logger.error({ error }, 'Error destroying Discord client');
    }

    try {
      await closeDatabase();
      ctx.logger.info('Database pool closed.');
    } catch (error) {
      ctx.logger.error({ error }, 'Error closing database pool');
    }

    ctx.logger.info('Shutdown complete.');
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
