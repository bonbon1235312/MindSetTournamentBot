import { Events } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { createLogger } from '../utils/logger.js';
import { createDatabase } from '../database/client.js';
import { createDiscordClient } from '../discord/client.js';
import { routeInteraction } from '../discord/interactions/router.js';
import { SchedulerService } from '../services/scheduler-service.js';
import type { AppContext } from '../types/context.js';

export async function bootstrap(): Promise<AppContext> {
  const env = loadEnv();
  const logger = createLogger(env);

  logger.info({ nodeEnv: env.NODE_ENV }, 'Starting MindSet Tournament Bot...');

  const db = createDatabase(env);
  logger.info('Database client ready.');

  const client = createDiscordClient();
  const scheduler = new SchedulerService(db, logger.child({ component: 'scheduler' }), env.SCHEDULER_WORKER_ID);

  const ctx: AppContext = { client, db, env, logger, scheduler };

  client.once(Events.ClientReady, (readyClient) => {
    logger.info({ tag: readyClient.user.tag, id: readyClient.user.id }, 'Discord client ready.');
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void routeInteraction(interaction, ctx);
  });

  client.on(Events.Error, (error) => {
    logger.error({ error }, 'Discord client error');
  });

  await client.login(env.DISCORD_TOKEN);

  await scheduler.reconcileOnStartup();
  scheduler.start();

  return ctx;
}
