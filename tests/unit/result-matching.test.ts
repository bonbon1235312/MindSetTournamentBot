import { describe, it, expect } from 'vitest';
import { normalizeSubmission, submissionsMatch } from '../../src/domain/fixtures/result-matching.js';

const HOME = 'home-entry';
const AWAY = 'away-entry';

describe('normalizeSubmission', () => {
  it('normalizes a home-side submission directly (submitter score = home score)', () => {
    const result = normalizeSubmission({ submittingEntryId: HOME, scoreForSubmitter: 3, scoreForOpponent: 1 }, HOME, AWAY);
    expect(result.homeScore).toBe(3);
    expect(result.awayScore).toBe(1);
    expect(result.winnerEntryId).toBe(HOME);
  });

  it('normalizes an away-side submission by flipping the perspective', () => {
    // The away team submits "we scored 1, they scored 3" — must map to
    // homeScore=3, awayScore=1, NOT the raw submitted order.
    const result = normalizeSubmission({ submittingEntryId: AWAY, scoreForSubmitter: 1, scoreForOpponent: 3 }, HOME, AWAY);
    expect(result.homeScore).toBe(3);
    expect(result.awayScore).toBe(1);
    expect(result.winnerEntryId).toBe(HOME);
  });

  it('two independent submissions describing the same real result normalize to an identical canonical result', () => {
    const fromHome = normalizeSubmission({ submittingEntryId: HOME, scoreForSubmitter: 2, scoreForOpponent: 2 }, HOME, AWAY);
    const fromAway = normalizeSubmission({ submittingEntryId: AWAY, scoreForSubmitter: 2, scoreForOpponent: 2 }, HOME, AWAY);
    expect(submissionsMatch(fromHome, fromAway)).toBe(true);
  });

  it('detects a genuine conflict between two submissions', () => {
    const fromHome = normalizeSubmission({ submittingEntryId: HOME, scoreForSubmitter: 3, scoreForOpponent: 1 }, HOME, AWAY);
    const fromAway = normalizeSubmission({ submittingEntryId: AWAY, scoreForSubmitter: 0, scoreForOpponent: 2 }, HOME, AWAY);
    // Home claims 3-1, away claims 2-0 (their favour) — genuinely different.
    expect(submissionsMatch(fromHome, fromAway)).toBe(false);
  });

  it('throws if the submitting entry is neither side of the fixture', () => {
    expect(() => normalizeSubmission({ submittingEntryId: 'stranger', scoreForSubmitter: 1, scoreForOpponent: 0 }, HOME, AWAY)).toThrow();
  });

  it('derives the winner from penalties when the score is level', () => {
    const result = normalizeSubmission(
      { submittingEntryId: HOME, scoreForSubmitter: 1, scoreForOpponent: 1, decisionMethod: 'PENALTIES', penaltyForSubmitter: 5, penaltyForOpponent: 4 },
      HOME,
      AWAY,
    );
    expect(result.homeScore).toBe(1);
    expect(result.awayScore).toBe(1);
    expect(result.penaltyHome).toBe(5);
    expect(result.penaltyAway).toBe(4);
    expect(result.winnerEntryId).toBe(HOME);
  });

  it('normalizes penalty scores from the away perspective too', () => {
    const result = normalizeSubmission(
      { submittingEntryId: AWAY, scoreForSubmitter: 1, scoreForOpponent: 1, decisionMethod: 'PENALTIES', penaltyForSubmitter: 5, penaltyForOpponent: 3 },
      HOME,
      AWAY,
    );
    expect(result.penaltyHome).toBe(3);
    expect(result.penaltyAway).toBe(5);
    expect(result.winnerEntryId).toBe(AWAY);
  });

  it('leaves winnerEntryId null for a level group-stage draw with no decision method', () => {
    const result = normalizeSubmission({ submittingEntryId: HOME, scoreForSubmitter: 1, scoreForOpponent: 1 }, HOME, AWAY);
    expect(result.winnerEntryId).toBeNull();
  });
});

describe('submissionsMatch', () => {
  it('does not double-resolve: a duplicate identical submission still matches (idempotent)', () => {
    const a = normalizeSubmission({ submittingEntryId: HOME, scoreForSubmitter: 2, scoreForOpponent: 0 }, HOME, AWAY);
    const b = normalizeSubmission({ submittingEntryId: HOME, scoreForSubmitter: 2, scoreForOpponent: 0 }, HOME, AWAY);
    expect(submissionsMatch(a, b)).toBe(true);
  });

  it('treats a difference in decision method as a conflict even with the same score', () => {
    const a = normalizeSubmission({ submittingEntryId: HOME, scoreForSubmitter: 1, scoreForOpponent: 1, decisionMethod: 'PENALTIES', penaltyForSubmitter: 5, penaltyForOpponent: 4 }, HOME, AWAY);
    const b = normalizeSubmission({ submittingEntryId: HOME, scoreForSubmitter: 1, scoreForOpponent: 1, decisionMethod: 'EXTRA_TIME' }, HOME, AWAY);
    expect(submissionsMatch(a, b)).toBe(false);
  });
});
