import { GatewayIntentBits } from 'discord.js';

/**
 * Every user-facing flow in this bot is button/modal/select-driven (section
 * 3: "No normal user should need slash commands"), including group
 * confirmation, which is implemented as a ✅ button rather than a raw emoji
 * reaction — so we deliberately do NOT need the privileged Message Content
 * or GuildMessageReactions intents.
 *
 * GuildMembers IS requested (as of the welcome/goodbye feature) purely to
 * receive the GuildMemberAdd/GuildMemberRemove gateway events those
 * listeners need — every other member lookup in this codebase is still a
 * targeted REST fetch that doesn't need this intent. This is a privileged
 * intent: "Server Members Intent" must be enabled for this application in
 * the Discord Developer Portal (Bot tab), or the gateway will hard-reject
 * the connection ("Used disallowed intents") — verified live against the
 * real bot after enabling it there.
 */
export const REQUIRED_INTENTS = [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers];
