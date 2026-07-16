import { GatewayIntentBits } from 'discord.js';

/**
 * Every user-facing flow in this bot is button/modal/select-driven (section
 * 3: "No normal user should need slash commands"), including group
 * confirmation, which is implemented as a ✅ button rather than a raw emoji
 * reaction — so we deliberately do NOT need the privileged Message Content
 * or GuildMessageReactions intents.
 *
 * We also do NOT request the privileged GuildMembers intent: every member
 * lookup in this codebase is a targeted REST fetch (`guild.members.fetch(
 * userId)`), which works regardless of that gateway intent — it only gates
 * bulk member lists and MEMBER_ADD/UPDATE/REMOVE gateway events, neither of
 * which this bot uses. Requesting it anyway would force staff to flip on
 * "Server Members Intent" in the Discord Developer Portal for no benefit,
 * and the gateway hard-rejects the connection ("Used disallowed intents")
 * if it's requested but not enabled there — verified live against the real
 * bot before settling on this intent set.
 */
export const REQUIRED_INTENTS = [GatewayIntentBits.Guilds];
