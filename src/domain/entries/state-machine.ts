import type { entryStatusEnum } from '../../database/schema/enums.js';
import { InvalidStateTransitionError } from '../../types/errors.js';

export type EntryStatus = (typeof entryStatusEnum.enumValues)[number];

/** Legal transitions for a tournament entry (section 45 + section 15's
 * INACTIVE_PENDING_REPLACEMENT extension). WITHDRAWN/KICKED/DISQUALIFIED/
 * ELIMINATED/WINNER are terminal for that entry within this tournament. */
const FORWARD_TRANSITIONS: Record<EntryStatus, EntryStatus[]> = {
  AWAITING_PAYMENT: ['CONFIRMED', 'RESERVE', 'WITHDRAWN', 'KICKED'],
  CONFIRMED: ['RESERVE', 'GROUPED', 'WITHDRAWN', 'KICKED'],
  RESERVE: ['CONFIRMED', 'GROUPED', 'WITHDRAWN', 'KICKED'],
  GROUPED: ['ACTIVE', 'INACTIVE_PENDING_REPLACEMENT', 'WITHDRAWN', 'KICKED'],
  ACTIVE: [
    'INACTIVE_PENDING_REPLACEMENT',
    'ELIMINATED',
    'WINNER',
    'WITHDRAWN',
    'KICKED',
    'DISQUALIFIED',
  ],
  INACTIVE_PENDING_REPLACEMENT: ['ACTIVE', 'WITHDRAWN', 'KICKED'],
  WITHDRAWN: [],
  KICKED: [],
  DISQUALIFIED: [],
  ELIMINATED: [],
  WINNER: [],
};

export function canTransitionEntry(from: EntryStatus, to: EntryStatus): boolean {
  if (from === to) return false;
  return FORWARD_TRANSITIONS[from].includes(to);
}

export function assertEntryTransition(from: EntryStatus, to: EntryStatus): void {
  if (!canTransitionEntry(from, to)) {
    throw new InvalidStateTransitionError('tournament entry', from, to);
  }
}

export const ACTIVE_ENTRY_STATUSES: readonly EntryStatus[] = [
  'AWAITING_PAYMENT',
  'CONFIRMED',
  'RESERVE',
  'GROUPED',
  'ACTIVE',
  'INACTIVE_PENDING_REPLACEMENT',
];

export function isActiveEntryStatus(status: EntryStatus): boolean {
  return ACTIVE_ENTRY_STATUSES.includes(status);
}
