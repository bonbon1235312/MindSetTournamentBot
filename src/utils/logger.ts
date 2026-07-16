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
