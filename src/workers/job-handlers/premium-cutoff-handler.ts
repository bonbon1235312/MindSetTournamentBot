import type { ScheduledJob } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getTournamentById } from '../../database/repositories/tournament-repository.js';
import { advanceTournamentTo } from '../../services/tournament-progression-service.js';

/** Section 5: premium priority ends at 7pm. Functionally this only affects
 * the announcement embed's displayed status — actual premium eligibility
 * is computed by wall-clock comparison at signup time regardless (see
 * signup-flow.ts), so this job is a status-accuracy step, not a gate. */
export async function handlePremiumCutoff(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const tournamentId = job.tournamentId;
  if (!tournamentId) throw new Error('PREMIUM_CUTOFF job is missing tournamentId');

  const tournament = await getTournamentById(ctx.db, tournamentId);
  if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);
  if (tournament.paused) {
    ctx.logger.info({ tournamentId }, 'Tournament paused — skipping premium cutoff transition');
    return;
  }
  if (tournament.status !== 'PREMIUM_SIGNUP') {
    ctx.logger.info({ tournamentId, status: tournament.status }, 'Not in PREMIUM_SIGNUP — nothing to do (idempotent)');
    return;
  }

  await advanceTournamentTo(ctx.db, tournament, 'GENERAL_SIGNUP');
}
