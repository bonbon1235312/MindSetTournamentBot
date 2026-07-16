import type { Client } from 'discord.js';
import type { Database } from '../database/client.js';
import type { Env } from '../config/env.js';
import type { Logger } from '../utils/logger.js';
import type { SchedulerService } from '../services/scheduler-service.js';

/** Dependency bundle threaded through every Discord handler and service.
 * Never construct ad hoc — always come from app/bootstrap.ts. */
export interface AppContext {
  client: Client;
  db: Database;
  env: Env;
  logger: Logger;
  scheduler: SchedulerService;
}
