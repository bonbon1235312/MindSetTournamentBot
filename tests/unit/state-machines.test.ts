import { describe, it, expect } from 'vitest';
import { canTransitionTournament, assertTournamentTransition, isTerminalTournamentStatus } from '../../src/domain/tournaments/state-machine.js';
import { canTransitionEntry, assertEntryTransition, isActiveEntryStatus } from '../../src/domain/entries/state-machine.js';
import { canTransitionFixture, assertFixtureTransition, isResolvedFixtureStatus } from '../../src/domain/fixtures/state-machine.js';
import { InvalidStateTransitionError } from '../../src/types/errors.js';

describe('tournament state machine', () => {
  it('allows the normal forward lifecycle', () => {
    const path: Array<Parameters<typeof canTransitionTournament>> = [
      ['DRAFT', 'PUBLISHED'],
      ['PUBLISHED', 'PREMIUM_SIGNUP'],
      ['PREMIUM_SIGNUP', 'GENERAL_SIGNUP'],
      ['GENERAL_SIGNUP', 'PAYMENT_LOCKED'],
      ['PAYMENT_LOCKED', 'SIGNUP_CLOSED'],
      ['SIGNUP_CLOSED', 'GENERATING_GROUPS'],
      ['GENERATING_GROUPS', 'GROUP_CONFIRMATION'],
      ['GROUP_CONFIRMATION', 'GROUP_STAGE_LIVE'],
      ['GROUP_STAGE_LIVE', 'CALCULATING_QUALIFIERS'],
      ['CALCULATING_QUALIFIERS', 'QUALIFICATION_REVIEW'],
      ['QUALIFICATION_REVIEW', 'KNOCKOUT_LIVE'],
      ['KNOCKOUT_LIVE', 'FINAL_LIVE'],
      ['FINAL_LIVE', 'COMPLETED'],
      ['COMPLETED', 'CLEANING_UP'],
      ['CLEANING_UP', 'CLEANED'],
    ];
    for (const [from, to] of path) {
      expect(canTransitionTournament(from, to)).toBe(true);
    }
  });

  it('rejects skipping stages', () => {
    expect(canTransitionTournament('DRAFT', 'GROUP_STAGE_LIVE')).toBe(false);
  });

  it('rejects moving backwards', () => {
    expect(canTransitionTournament('KNOCKOUT_LIVE', 'GROUP_STAGE_LIVE')).toBe(false);
  });

  it('allows cancellation from most non-terminal states', () => {
    expect(canTransitionTournament('GROUP_STAGE_LIVE', 'CANCELLED')).toBe(true);
    expect(canTransitionTournament('PREMIUM_SIGNUP', 'CANCELLED')).toBe(true);
  });

  it('always gives CANCELLED a path to cleanup', () => {
    expect(canTransitionTournament('CANCELLED', 'CLEANING_UP')).toBe(true);
  });

  it('rejects a no-op transition to the same state', () => {
    expect(canTransitionTournament('DRAFT', 'DRAFT')).toBe(false);
  });

  it('assertTournamentTransition throws InvalidStateTransitionError on an illegal move', () => {
    expect(() => assertTournamentTransition('DRAFT', 'COMPLETED')).toThrow(InvalidStateTransitionError);
  });

  it('CLEANED is terminal', () => {
    expect(isTerminalTournamentStatus('CLEANED')).toBe(true);
    expect(isTerminalTournamentStatus('DRAFT')).toBe(false);
  });
});

describe('entry state machine', () => {
  it('allows the normal happy-path lifecycle', () => {
    expect(canTransitionEntry('AWAITING_PAYMENT', 'CONFIRMED')).toBe(true);
    expect(canTransitionEntry('CONFIRMED', 'GROUPED')).toBe(true);
    expect(canTransitionEntry('GROUPED', 'ACTIVE')).toBe(true);
    expect(canTransitionEntry('ACTIVE', 'WINNER')).toBe(true);
  });

  it('allows the reserve promotion path', () => {
    expect(canTransitionEntry('AWAITING_PAYMENT', 'RESERVE')).toBe(true);
    expect(canTransitionEntry('RESERVE', 'CONFIRMED')).toBe(true);
    expect(canTransitionEntry('RESERVE', 'GROUPED')).toBe(true);
  });

  it('allows the group-confirmation-timeout path (section 15)', () => {
    expect(canTransitionEntry('GROUPED', 'INACTIVE_PENDING_REPLACEMENT')).toBe(true);
    expect(canTransitionEntry('INACTIVE_PENDING_REPLACEMENT', 'ACTIVE')).toBe(true);
  });

  it('treats WITHDRAWN, KICKED, DISQUALIFIED, ELIMINATED, WINNER as terminal', () => {
    for (const terminal of ['WITHDRAWN', 'KICKED', 'DISQUALIFIED', 'ELIMINATED', 'WINNER'] as const) {
      expect(canTransitionEntry(terminal, 'ACTIVE')).toBe(false);
    }
  });

  it('never allows moving straight from AWAITING_PAYMENT to WINNER', () => {
    expect(canTransitionEntry('AWAITING_PAYMENT', 'WINNER')).toBe(false);
  });

  it('assertEntryTransition throws on an illegal move', () => {
    expect(() => assertEntryTransition('WITHDRAWN', 'ACTIVE')).toThrow(InvalidStateTransitionError);
  });

  it('classifies active-in-tournament statuses correctly', () => {
    expect(isActiveEntryStatus('ACTIVE')).toBe(true);
    expect(isActiveEntryStatus('AWAITING_PAYMENT')).toBe(true);
    expect(isActiveEntryStatus('WITHDRAWN')).toBe(false);
    expect(isActiveEntryStatus('WINNER')).toBe(false);
  });
});

describe('fixture state machine', () => {
  it('allows the dual-submission happy path', () => {
    expect(canTransitionFixture('SCHEDULED', 'READY')).toBe(true);
    expect(canTransitionFixture('READY', 'WAITING_FOR_SUBMISSIONS')).toBe(true);
    expect(canTransitionFixture('WAITING_FOR_SUBMISSIONS', 'WAITING_FOR_OPPONENT')).toBe(true);
    expect(canTransitionFixture('WAITING_FOR_OPPONENT', 'RESOLVED')).toBe(true);
  });

  it('allows a conflict path', () => {
    expect(canTransitionFixture('WAITING_FOR_SUBMISSIONS', 'RESULT_CONFLICT')).toBe(true);
    expect(canTransitionFixture('RESULT_CONFLICT', 'RESOLVED')).toBe(true);
  });

  it('allows staff to reopen a RESOLVED fixture for correction (section 18/27)', () => {
    expect(canTransitionFixture('RESOLVED', 'WAITING_FOR_SUBMISSIONS')).toBe(true);
  });

  it('allows staff to reopen a FORFEIT fixture', () => {
    expect(canTransitionFixture('FORFEIT', 'WAITING_FOR_SUBMISSIONS')).toBe(true);
  });

  it('treats VOID as a true dead end', () => {
    expect(canTransitionFixture('VOID', 'RESOLVED')).toBe(false);
    expect(canTransitionFixture('VOID', 'WAITING_FOR_SUBMISSIONS')).toBe(false);
  });

  it('assertFixtureTransition throws on an illegal move', () => {
    expect(() => assertFixtureTransition('SCHEDULED', 'RESOLVED')).toThrow(InvalidStateTransitionError);
  });

  it('classifies resolved-family statuses correctly', () => {
    expect(isResolvedFixtureStatus('RESOLVED')).toBe(true);
    expect(isResolvedFixtureStatus('FORFEIT')).toBe(true);
    expect(isResolvedFixtureStatus('VOID')).toBe(true);
    expect(isResolvedFixtureStatus('SCHEDULED')).toBe(false);
    expect(isResolvedFixtureStatus('RESULT_CONFLICT')).toBe(false);
  });
});
