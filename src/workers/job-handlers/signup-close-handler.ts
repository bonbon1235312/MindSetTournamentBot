import type { ScheduledJob } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getTournamentById } from '../../database/repositories/tournament-repository.js';
import { advanceTournamentTo, isAtOrPastStatus } from '../../services/tournament-progression-service.js';

/** Section 4: signups stay technically open until 9pm. Moving to
 * SIGNUP_CLOSED removes the tournament from SIGNUP_ACCEPTING_STATUSES so
 * the Sign Up button starts rejecting new entries — GROUP_PUBLISH runs at
 * the same default time and will walk through this status itself if this
 * job hasn't landed first, so ordering between the two doesn't matter. */
export async function handleSignupClose(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const tournamentId = job.tournamentId;
  if (!tournamentId) throw new Error('SIGNUP_CLOSE job is missing tournamentId');

  const tournament = await getTournamentById(ctx.db, tournamentId);
  if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);
  if (tournament.paused) {
    ctx.logger.info({ tournamentId }, 'Tournament paused — skipping signup close transition');
    return;
  }
  if (isAtOrPastStatus(tournament.status, 'SIGNUP_CLOSED')) {
    ctx.logger.info({ tournamentId, status: tournament.status }, 'Signups already closed — nothing to do (idempotent)');
    return;
  }

  await advanceTournamentTo(ctx.db, tournament, 'SIGNUP_CLOSED');
}
