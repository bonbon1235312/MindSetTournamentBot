import { Events, type Client } from 'discord.js';
import { loadEnv } from '../config/env.js';
import { createLogger, type Logger } from '../utils/logger.js';
import { createDatabase } from '../database/client.js';
import { createDiscordClient } from '../discord/client.js';
import { routeInteraction } from '../discord/interactions/router.js';
import { registerMemberEventListeners } from '../discord/listeners/member-events.js';
import { registerJobHandlers } from '../workers/job-handlers/index.js';
import { SchedulerService } from '../services/scheduler-service.js';
import type { AppContext } from '../types/context.js';

const LOGIN_ATTEMPT_TIMEOUT_MS = 30_000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_RETRY_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000];

/**
 * A single stalled/failed gateway handshake (a transient Discord or network
 * hiccup — not something this bot can control) used to hard-crash the whole
 * process, requiring a manual restart. Retries with backoff instead, so a
 * one-off stall doesn't take the bot down; still throws after
 * LOGIN_MAX_ATTEMPTS so a genuinely bad token or persistent outage doesn't
 * retry forever.
 *
 * A failed/timed-out login's underlying WebSocket attempt isn't necessarily
 * cancelled just because our timeout promise won the race, so each attempt
 * gets a brand-new Client (via `createClient`) rather than reusing one —
 * avoids any ambiguity around double-connecting or stacked internal
 * listeners on a client whose previous login attempt might still resolve
 * late in the background. Failed clients are destroyed before retrying.
 */
async function loginWithRetry(createClient: () => Client, token: string, logger: Logger): Promise<Client> {
  for (let attempt = 1; attempt <= LOGIN_MAX_ATTEMPTS; attempt++) {
    console.log(`[MindSet boot] connecting to Discord... (attempt ${attempt}/${LOGIN_MAX_ATTEMPTS})`);
    const client = createClient();
    try {
      await Promise.race([
        client.login(token),
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Discord login timed out after ${LOGIN_ATTEMPT_TIMEOUT_MS / 1000} seconds`)), LOGIN_ATTEMPT_TIMEOUT_MS).unref();
        }),
      ]);
      return client;
    } catch (error) {
      client.destroy();
      if (attempt === LOGIN_MAX_ATTEMPTS) throw error;
      const backoffMs = LOGIN_RETRY_BACKOFF_MS[attempt - 1] ?? LOGIN_RETRY_BACKOFF_MS[LOGIN_RETRY_BACKOFF_MS.length - 1]!;
      logger.warn({ error, attempt, backoffMs }, 'Discord login attempt failed — retrying');
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw new Error('unreachable');
}

export async function bootstrap(): Promise<AppContext> {
  const env = loadEnv();
  const logger = createLogger(env);

  console.log(`[MindSet boot] environment validated (NODE_ENV=${env.NODE_ENV})`);
  logger.info({ nodeEnv: env.NODE_ENV }, 'Starting MindSet Tournament Bot...');

  const db = createDatabase(env);
  console.log('[MindSet boot] database client created');
  logger.info('Database client ready.');

  const scheduler = new SchedulerService(db, logger.child({ component: 'scheduler' }), env.SCHEDULER_WORKER_ID);

  // ClientReady/Error must be attached before login() (discord.js may emit
  // ready before login()'s own promise settles), so each retry attempt's
  // fresh client gets them wired up here. InteractionCreate and the member
  // listeners need `ctx`, which can't exist until we know which client
  // instance actually won — those are attached below, after a successful
  // login, which is safe since neither event can fire before the gateway
  // session (and therefore this function's return) is established anyway.
  const client = await loginWithRetry(
    () => {
      const attemptClient = createDiscordClient(env);
      attemptClient.once(Events.ClientReady, (readyClient) => {
        logger.info(
          { tag: readyClient.user.tag, id: readyClient.user.id, status: env.BOT_STATUS_TEXT },
          'Discord client ready.',
        );
      });
      attemptClient.on(Events.Error, (error) => {
        logger.error({ error }, 'Discord client error');
      });
      return attemptClient;
    },
    env.DISCORD_TOKEN,
    logger,
  );
  console.log(`[MindSet boot] Discord connected as ${client.user?.tag ?? 'unknown user'}`);

  const ctx: AppContext = { client, db, env, logger, scheduler };
  registerJobHandlers(ctx);

  client.on(Events.InteractionCreate, (interaction) => {
    void routeInteraction(interaction, ctx);
  });

  registerMemberEventListeners(client, ctx);

  console.log('[MindSet boot] reconciling scheduler jobs...');
  await scheduler.reconcileOnStartup();
  scheduler.start();
  console.log('[MindSet boot] startup complete');

  return ctx;
}
