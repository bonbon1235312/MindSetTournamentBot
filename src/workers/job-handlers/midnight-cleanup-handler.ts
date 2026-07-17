import type { ScheduledJob } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getTournamentById, updateTournamentStatus } from '../../database/repositories/tournament-repository.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { assertTournamentTransition } from '../../domain/tournaments/state-machine.js';

/** Sections 33/34: runs once per tournament, at midnight the night after
 * its scheduled play date. A finished tournament (COMPLETED/CANCELLED)
 * gets walked to CLEANED — a status marker only, this never deletes
 * Discord resources or database rows for a real tournament (unlike
 * /tournament test's diagnostic cleanup). A tournament that's still
 * mid-flight past its own midnight is left completely alone — staff get
 * an alert, nothing here forces a state change on something that might
 * still be legitimately in progress. */
export async function handleMidnightCleanup(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const tournamentId = job.tournamentId;
  if (!tournamentId) throw new Error('MIDNIGHT_CLEANUP job is missing tournamentId');

  const tournament = await getTournamentById(ctx.db, tournamentId);
  if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);

  if (tournament.status === 'CLEANED') {
    ctx.logger.info({ tournamentId }, 'Tournament already CLEANED — nothing to do');
    return;
  }

  if (tournament.status === 'COMPLETED' || tournament.status === 'CANCELLED') {
    // COMPLETED/CANCELLED -> CLEANING_UP -> CLEANED is a terminal branch off
    // the main lifecycle, not part of tournament-progression-service's
    // linear STATUS_PATH — walked directly here instead of via
    // advanceTournamentTo.
    let current = tournament;
    if (current.status !== 'CLEANING_UP') {
      assertTournamentTransition(current.status, 'CLEANING_UP');
      current = await updateTournamentStatus(ctx.db, current.id, current.version, 'CLEANING_UP');
    }
    assertTournamentTransition(current.status, 'CLEANED');
    await updateTournamentStatus(ctx.db, current.id, current.version, 'CLEANED');
    ctx.logger.info({ tournamentId }, 'Tournament finalized to CLEANED at midnight cleanup');
    return;
  }

  const config = await getOrCreateGuildConfig(ctx.db, tournament.guildId);
  if (config.auditLogChannelId) {
    const guild = await ctx.client.guilds.fetch(tournament.guildId).catch(() => null);
    const channel = guild ? await guild.channels.fetch(config.auditLogChannelId).catch(() => null) : null;
    if (channel?.isTextBased()) {
      await channel
        .send(
          `⚠️ **${tournament.name}** is still \`${tournament.status}\` past its scheduled midnight cleanup — ` +
            'it may be stuck. Run `/tournament repair` for a diagnostic report.',
        )
        .catch((error: unknown) => ctx.logger.warn({ error, tournamentId }, 'Could not post the midnight-cleanup staff alert'));
    }
  }
  ctx.logger.warn({ tournamentId, status: tournament.status }, 'Tournament not finished by midnight cleanup — staff alerted');
}
