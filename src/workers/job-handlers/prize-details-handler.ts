import type { ScheduledJob } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getEntryById } from '../../database/repositories/entry-repository.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import { getTournamentById } from '../../database/repositories/tournament-repository.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';

/** Section 9, +24 hours after a tournament completes: if the winner's
 * prize payment is still PRIZE_PENDING, nudge staff in the audit-log
 * channel so it doesn't get forgotten. Staff arrange the actual payout
 * (PayPal/Revolut, etc.) manually via the existing payment panel — this
 * job is purely a reminder, not a new payment-collection flow. */
export async function handlePrizeDetailsDeadline(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const entryId = job.payload.entryId as string | undefined;
  if (!entryId) throw new Error('PRIZE_DETAILS_DEADLINE job is missing payload.entryId');

  const entry = await getEntryById(ctx.db, entryId);
  if (!entry) throw new Error(`Entry ${entryId} not found`);
  if (entry.paymentStatus !== 'PRIZE_PENDING') {
    ctx.logger.info({ entryId, paymentStatus: entry.paymentStatus }, 'Prize already handled — reminder skipped');
    return;
  }

  const tournament = await getTournamentById(ctx.db, entry.tournamentId);
  if (!tournament) return;
  const config = await getOrCreateGuildConfig(ctx.db, tournament.guildId);
  if (!config.auditLogChannelId) return;

  const club = await getClubById(ctx.db, entry.clubId);
  const guild = await ctx.client.guilds.fetch(tournament.guildId).catch(() => null);
  const channel = guild ? await guild.channels.fetch(config.auditLogChannelId).catch(() => null) : null;
  if (!channel?.isTextBased()) return;

  await channel
    .send(
      `💳 **Prize payout reminder:** ${club?.displayName ?? 'The champion'} (${tournament.name}) still hasn't been paid ` +
        '24 hours after the tournament finished — use `/payments` to arrange it.',
    )
    .catch((error: unknown) => ctx.logger.warn({ error, entryId }, 'Could not post the prize-payout reminder'));

  ctx.logger.info({ entryId }, 'Prize still pending 24h after tournament completion — staff alerted');
}
