import type { Database } from '../database/client.js';
import type { Tournament } from '../database/schema/index.js';
import { updateTournamentStatus } from '../database/repositories/tournament-repository.js';
import { assertTournamentTransition, type TournamentStatus } from '../domain/tournaments/state-machine.js';

/** The normal forward lifecycle (section 45), in order. Job handlers use
 * this to walk a tournament from wherever it currently sits up to a target
 * status one legal hop at a time, rather than assuming any single job
 * always finds it in exactly the status it expects — jobs can race (e.g.
 * SIGNUP_CLOSE and GROUP_PUBLISH share a default run time). */
const STATUS_PATH: TournamentStatus[] = [
  'DRAFT',
  'PUBLISHED',
  'PREMIUM_SIGNUP',
  'GENERAL_SIGNUP',
  'PAYMENT_LOCKED',
  'SIGNUP_CLOSED',
  'GENERATING_GROUPS',
  'GROUP_CONFIRMATION',
  'GROUP_STAGE_LIVE',
  'CALCULATING_QUALIFIERS',
  'QUALIFICATION_REVIEW',
  'KNOCKOUT_LIVE',
  'FINAL_LIVE',
  'COMPLETED',
];

/** True if `status` is at or past `target` on the normal forward lifecycle
 * — lets a job handler treat "already past this point" as a safe no-op
 * instead of calling advanceTournamentTo and hitting its backwards-move
 * guard (useful for idempotency checks when a job fires late/retried). */
export function isAtOrPastStatus(status: TournamentStatus, target: TournamentStatus): boolean {
  const statusIndex = STATUS_PATH.indexOf(status);
  const targetIndex = STATUS_PATH.indexOf(target);
  return statusIndex !== -1 && targetIndex !== -1 && statusIndex >= targetIndex;
}

/**
 * Advances `tournament` step-by-step to `targetStatus`, validating every
 * hop via assertTournamentTransition (never a raw status write) and
 * re-checking `version` after each hop for real optimistic-concurrency
 * safety even across a multi-step walk. Already-there and already-past are
 * both safe no-ops in the appropriate direction: exactly at the target
 * returns immediately; already past it throws (a job should never need to
 * rewind a tournament — that's an admin override's job, not a scheduled
 * one).
 */
export async function advanceTournamentTo(db: Database, tournament: Tournament, targetStatus: TournamentStatus): Promise<Tournament> {
  const fromIndex = STATUS_PATH.indexOf(tournament.status);
  const toIndex = STATUS_PATH.indexOf(targetStatus);
  if (fromIndex === -1 || toIndex === -1) {
    throw new Error(`"${tournament.status}" or "${targetStatus}" is not on the normal forward lifecycle path.`);
  }
  if (toIndex < fromIndex) {
    throw new Error(`Refusing to move tournament ${tournament.id} backwards from ${tournament.status} to ${targetStatus}.`);
  }

  let current = tournament;
  for (let i = fromIndex; i < toIndex; i++) {
    const next = STATUS_PATH[i + 1]!;
    assertTournamentTransition(current.status, next);
    current = await updateTournamentStatus(db, current.id, current.version, next);
  }
  return current;
}
