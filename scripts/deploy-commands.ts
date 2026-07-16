import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadEnv } from '../src/config/env.js';
import { commands } from '../src/discord/commands/index.js';

async function main() {
  const env = loadEnv();
  const rest = new REST().setToken(env.DISCORD_TOKEN);
  const body = commands.map((c) => c.data.toJSON());

  if (env.COMMAND_DEPLOY_MODE === 'guild') {
    if (!env.DISCORD_GUILD_ID) {
      console.error('COMMAND_DEPLOY_MODE=guild requires DISCORD_GUILD_ID.');
      process.exit(1);
    }
    console.log(`Deploying ${body.length} command(s) to guild ${env.DISCORD_GUILD_ID}...`);
    await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body });
    console.log('Guild command deployment complete (instant propagation).');
  } else {
    console.log(`Deploying ${body.length} command(s) globally...`);
    await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body });
    console.log('Global command deployment complete (can take up to an hour to propagate).');
  }
}

main().catch((error: unknown) => {
  console.error('Command deployment failed:', error);
  process.exit(1);
});
