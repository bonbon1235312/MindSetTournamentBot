import pino from 'pino';
import type { Env } from '../config/env.js';

export type Logger = pino.Logger;

/**
 * Root structured logger. Bind child loggers with correlationId/guildId/
 * tournamentId/etc via `.child({...})` at each call site rather than
 * threading context through function arguments everywhere.
 */
export function createLogger(env: Pick<Env, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  const isDev = env.NODE_ENV !== 'production';

  const options: pino.LoggerOptions = {
    level: env.LOG_LEVEL,
    base: { pid: process.pid },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Every call site in this codebase logs errors under the key `error`
    // (never pino's default `err`), which pino otherwise serializes with a
    // naive JSON.stringify — producing `{}` for a bare Error, since
    // message/stack aren't own-enumerable properties. This maps `error` to
    // pino's real Error serializer so message/stack/cause actually show up.
    serializers: { error: pino.stdSerializers.err },
  };

  if (isDev) {
    options.transport = {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'HH:MM:ss',
        ignore: 'pid,hostname',
      },
    };
  }

  return pino(options);
}
