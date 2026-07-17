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

/**
 * Walks a COMPLETED or CANCELLED tournament through to CLEANED — a
 * terminal branch off the main lifecycle (see the state machine), not a
 * continuation of STATUS_PATH above, so this walks it directly via
 * assertTournamentTransition rather than through advanceTournamentTo
 * (which would correctly reject CLEANING_UP/CLEANED as off its path).
 * Status-only: never touches Discord resources or database rows beyond
 * the tournament's own status column.
 */
export async function finalizeToCleaned(db: Database, tournament: Tournament): Promise<Tournament> {
  let current = tournament;
  if (current.status !== 'CLEANING_UP' && current.status !== 'CLEANED') {
    assertTournamentTransition(current.status, 'CLEANING_UP');
    current = await updateTournamentStatus(db, current.id, current.version, 'CLEANING_UP');
  }
  if (current.status !== 'CLEANED') {
    assertTournamentTransition(current.status, 'CLEANED');
    current = await updateTournamentStatus(db, current.id, current.version, 'CLEANED');
  }
  return current;
}

/**
 * Staff-initiated cancellation (e.g. a stuck test tournament, or a real
 * cup called off) — moves straight to CANCELLED from wherever the
 * tournament currently sits (legal from any non-terminal status per the
 * state machine), then immediately finishes the CLEANING_UP -> CLEANED
 * walk so it stops blocking the "one cup at a time" active-tournament
 * check right away, rather than waiting on a MIDNIGHT_CLEANUP job that
 * may not exist for this tournament yet.
 */
export async function cancelAndFinalizeTournament(db: Database, tournament: Tournament): Promise<Tournament> {
  assertTournamentTransition(tournament.status, 'CANCELLED');
  const cancelled = await updateTournamentStatus(db, tournament.id, tournament.version, 'CANCELLED');
  return finalizeToCleaned(db, cancelled);
}
