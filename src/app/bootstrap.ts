import { Events } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { createDatabase } from '../database/client.js';
import { createDiscordClient } from '../discord/client.js';
import { routeInteraction } from '../discord/interactions/router.js';
import { registerMemberEventListeners } from '../discord/listeners/member-events.js';
import { registerJobHandlers } from '../workers/job-handlers/index.js';
import { SchedulerService } from '../services/scheduler-service.js';
import type { AppContext } from '../types/context.js';

export async function bootstrap(): Promise<AppContext> {
  const env = loadEnv();
  const logger = createLogger(env);

  console.log(`[MindSet boot] environment validated (NODE_ENV=${env.NODE_ENV})`);
  logger.info({ nodeEnv: env.NODE_ENV }, 'Starting MindSet Tournament Bot...');

  const db = createDatabase(env);
  console.log('[MindSet boot] database client created');
  logger.info('Database client ready.');

  const client = createDiscordClient(env);
  const scheduler = new SchedulerService(db, logger.child({ component: 'scheduler' }), env.SCHEDULER_WORKER_ID);

  const ctx: AppContext = { client, db, env, logger, scheduler };
  registerJobHandlers(ctx);

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(
      { tag: readyClient.user.tag, id: readyClient.user.id, status: env.BOT_STATUS_TEXT },
      'Discord client ready.',
    );
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void routeInteraction(interaction, ctx);
  });

  registerMemberEventListeners(client, ctx);

  client.on(Events.Error, (error) => {
    logger.error({ error }, 'Discord client error');
  });

  console.log('[MindSet boot] connecting to Discord...');
  await Promise.race([
    client.login(env.DISCORD_TOKEN),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Discord login timed out after 30 seconds')), 30_000).unref();
    }),
  ]);
  console.log(`[MindSet boot] Discord connected as ${client.user?.tag ?? 'unknown user'}`);

  console.log('[MindSet boot] reconciling scheduler jobs...');
  await scheduler.reconcileOnStartup();
  scheduler.start();
  console.log('[MindSet boot] startup complete');

  return ctx;
}
