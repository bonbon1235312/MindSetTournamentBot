import type { tournamentStatusEnum } from '../../database/schema/enums.js';
import { InvalidStateTransitionError } from '../../types/errors.js';

export type TournamentStatus = (typeof tournamentStatusEnum.enumValues)[number];

/**
 * Legal forward transitions for a tournament (section 45). Every non-
 * terminal state can also move to CANCELLED (staff action), and CANCELLED
 * can still move to CLEANING_UP so cleanup always has a path to run.
 */
const FORWARD_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
  DRAFT: ['PUBLISHED', 'CANCELLED'],
  PUBLISHED: ['PREMIUM_SIGNUP', 'CANCELLED'],
  PREMIUM_SIGNUP: ['GENERAL_SIGNUP', 'CANCELLED'],
  GENERAL_SIGNUP: ['PAYMENT_LOCKED', 'CANCELLED'],
  PAYMENT_LOCKED: ['SIGNUP_CLOSED', 'CANCELLED'],
  SIGNUP_CLOSED: ['GENERATING_GROUPS', 'CANCELLED'],
  GENERATING_GROUPS: ['GROUP_CONFIRMATION', 'CANCELLED'],
  GROUP_CONFIRMATION: ['GROUP_STAGE_LIVE', 'CANCELLED'],
  GROUP_STAGE_LIVE: ['CALCULATING_QUALIFIERS', 'CANCELLED'],
  CALCULATING_QUALIFIERS: ['QUALIFICATION_REVIEW', 'CANCELLED'],
  QUALIFICATION_REVIEW: ['KNOCKOUT_LIVE', 'CANCELLED'],
  KNOCKOUT_LIVE: ['FINAL_LIVE', 'CANCELLED'],
  FINAL_LIVE: ['COMPLETED', 'CANCELLED'],
  COMPLETED: ['CLEANING_UP'],
  CANCELLED: ['CLEANING_UP'],
  CLEANING_UP: ['CLEANED'],
  CLEANED: [],
};

export function canTransitionTournament(from: TournamentStatus, to: TournamentStatus): boolean {
  if (from === to) return false;
  return FORWARD_TRANSITIONS[from].includes(to);
}

export function assertTournamentTransition(from: TournamentStatus, to: TournamentStatus): void {
  if (!canTransitionTournament(from, to)) {
    throw new InvalidStateTransitionError('tournament', from, to);
  }
}

export function isTerminalTournamentStatus(status: TournamentStatus): boolean {
  return FORWARD_TRANSITIONS[status].length === 0;
}
