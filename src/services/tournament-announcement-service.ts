import type { Client } from 'discord.js';
import type { Database } from '../database/client.js';
import type { Logger } from '../utils/logger.js';
import { getTournamentById } from '../database/repositories/tournament-repository.js';
import { getEntriesByTournament } from '../database/repositories/entry-repository.js';
import { getOrCreateGuildConfig } from '../database/repositories/guild-config-repository.js';
import { buildAnnouncementEmbed, buildAnnouncementComponents } from '../discord/embeds/tournament-announcement.js';

/**
 * Section 6: "Do not create a new public message for every change. Edit the
 * persistent tournament message." Every flow that changes entry/payment/
 * tournament state should call this afterward.
 */
export async function refreshTournamentAnnouncement(
  client: Client,
  db: Database,
  logger: Logger,
  tournamentId: string,
): Promise<void> {
  const tournament = await getTournamentById(db, tournamentId);
  if (!tournament || !tournament.announcementChannelId || !tournament.announcementMessageId) return;

  const [entries, guildConfig] = await Promise.all([
    getEntriesByTournament(db, tournamentId),
    getOrCreateGuildConfig(db, tournament.guildId),
  ]);

  try {
    const channel = await client.channels.fetch(tournament.announcementChannelId);
    if (!channel?.isTextBased() || !('messages' in channel)) return;
    const message = await channel.messages.fetch(tournament.announcementMessageId);
    await message.edit({
      embeds: [buildAnnouncementEmbed(tournament, entries, guildConfig)],
      components: buildAnnouncementComponents(tournament.id),
    });
  } catch (error) {
    logger.warn({ tournamentId, error }, 'Failed to refresh tournament announcement message');
  }
}
