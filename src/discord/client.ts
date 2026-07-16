import { Client } from 'discord.js';
import { REQUIRED_INTENTS } from './intents.js';

export function createDiscordClient(): Client {
  return new Client({ intents: REQUIRED_INTENTS });
}
