import type { fixtureStatusEnum } from '../../database/schema/enums.js';
import { InvalidStateTransitionError } from '../../types/errors.js';

export type FixtureStatus = (typeof fixtureStatusEnum.enumValues)[number];

/** Legal transitions for a fixture (section 45). RESOLVED/FORFEIT/VOID are
 * terminal EXCEPT that staff can explicitly reopen a RESOLVED fixture back
 * to WAITING_FOR_SUBMISSIONS (section 18: "corrections require staff
 * reopening the fixture") — everything else stays a one-way door. */
const FORWARD_TRANSITIONS: Record<FixtureStatus, FixtureStatus[]> = {
  SCHEDULED: ['READY', 'VOID'],
  READY: ['WAITING_FOR_SUBMISSIONS', 'VOID'],
  WAITING_FOR_SUBMISSIONS: [
    'WAITING_FOR_OPPONENT',
    'RESULT_CONFLICT',
    'RESOLVED',
    'OVERDUE',
    'EVIDENCE_REQUESTED',
    'VOID',
    'FORFEIT',
  ],
  WAITING_FOR_OPPONENT: [
    'RESULT_CONFLICT',
    'RESOLVED',
    'OVERDUE',
    'EVIDENCE_REQUESTED',
    'VOID',
    'FORFEIT',
  ],
  RESULT_CONFLICT: ['RESOLVED', 'EVIDENCE_REQUESTED', 'VOID', 'FORFEIT', 'WAITING_FOR_SUBMISSIONS'],
  EVIDENCE_REQUESTED: ['RESOLVED', 'RESULT_CONFLICT', 'VOID', 'FORFEIT'],
  OVERDUE: ['RESOLVED', 'RESULT_CONFLICT', 'EVIDENCE_REQUESTED', 'VOID', 'FORFEIT'],
  RESOLVED: ['WAITING_FOR_SUBMISSIONS'], // staff-only reopen (section 18/27)
  FORFEIT: ['WAITING_FOR_SUBMISSIONS'], // staff-only reopen
  VOID: [],
};

export function canTransitionFixture(from: FixtureStatus, to: FixtureStatus): boolean {
  if (from === to) return false;
  return FORWARD_TRANSITIONS[from].includes(to);
}

export function assertFixtureTransition(from: FixtureStatus, to: FixtureStatus): void {
  if (!canTransitionFixture(from, to)) {
    throw new InvalidStateTransitionError('fixture', from, to);
  }
}

export function isResolvedFixtureStatus(status: FixtureStatus): boolean {
  return status === 'RESOLVED' || status === 'FORFEIT' || status === 'VOID';
}
