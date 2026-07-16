import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
  DISCORD_GUILD_ID: z.string().optional().default(''),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DEFAULT_TIMEZONE: z.string().default('Europe/London'),

  SCHEDULER_WORKER_ID: z.string().min(1, 'SCHEDULER_WORKER_ID is required'),
  GRAPHICS_CACHE_DIR: z.string().default('./data/graphics'),

  COMMAND_DEPLOY_MODE: z.enum(['guild', 'global']).default('guild'),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * Validates process.env once and caches the result. Throws with a readable
 * message listing every missing/invalid variable rather than failing on the
 * first one, so misconfiguration can be fixed in a single pass.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cachedEnv) return cachedEnv;

  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  if (result.data.COMMAND_DEPLOY_MODE === 'guild' && !result.data.DISCORD_GUILD_ID) {
    throw new Error(
      'Invalid environment configuration:\n  - DISCORD_GUILD_ID is required when COMMAND_DEPLOY_MODE=guild',
    );
  }

  cachedEnv = result.data;
  return cachedEnv;
}

/** Test-only: clears the cached env so loadEnv() re-validates on next call. */
export function _resetEnvCacheForTests(): void {
  cachedEnv = undefined;
}
