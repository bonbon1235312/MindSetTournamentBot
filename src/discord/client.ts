import { ActivityType, Client } from 'discord.js';
import type { Env } from '../config/env.js';
import { REQUIRED_INTENTS } from './intents.js';

export function createDiscordClient(env: Pick<Env, 'BOT_STATUS_TEXT'>): Client {
  return new Client({
    intents: REQUIRED_INTENTS,
    presence: {
      status: 'online',
      activities: [
        {
          name: 'Custom Status',
          state: env.BOT_STATUS_TEXT,
          type: ActivityType.Custom,
        },
      ],
    },
  });
}
