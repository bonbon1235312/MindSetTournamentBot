import { describe, it, expect } from 'vitest';
import { validateKnockoutResult } from '../../src/domain/fixtures/result-validation.js';
import type { CanonicalResult } from '../../src/domain/fixtures/result-matching.js';

const HOME = 'home-entry';
const AWAY = 'away-entry';

function result(overrides: Partial<CanonicalResult>): CanonicalResult {
  return { homeScore: 0, awayScore: 0, decisionMethod: null, penaltyHome: null, penaltyAway: null, winnerEntryId: null, ...overrides };
}

describe('validateKnockoutResult', () => {
  it('accepts a normal-time non-level result with the correct winner', () => {
    expect(() => validateKnockoutResult(result({ homeScore: 2, awayScore: 1, winnerEntryId: HOME }), HOME, AWAY)).not.toThrow();
  });

  it('accepts an extra-time non-level result', () => {
    expect(() =>
      validateKnockoutResult(result({ homeScore: 3, awayScore: 2, decisionMethod: 'EXTRA_TIME', winnerEntryId: HOME }), HOME, AWAY),
    ).not.toThrow();
  });

  it('rejects a non-level result whose declared winner contradicts the score', () => {
    expect(() => validateKnockoutResult(result({ homeScore: 2, awayScore: 1, winnerEntryId: AWAY }), HOME, AWAY)).toThrow(/winner/i);
  });

  it('rejects a level score without PENALTIES as the decision method', () => {
    expect(() => validateKnockoutResult(result({ homeScore: 1, awayScore: 1, decisionMethod: 'EXTRA_TIME' }), HOME, AWAY)).toThrow(/draw|penalt/i);
  });

  it('rejects a level score with no decision method at all', () => {
    expect(() => validateKnockoutResult(result({ homeScore: 0, awayScore: 0 }), HOME, AWAY)).toThrow();
  });

  it('accepts a level score with valid penalties and a matching winner', () => {
    expect(() =>
      validateKnockoutResult(
        result({ homeScore: 1, awayScore: 1, decisionMethod: 'PENALTIES', penaltyHome: 5, penaltyAway: 4, winnerEntryId: HOME }),
        HOME,
        AWAY,
      ),
    ).not.toThrow();
  });

  it('rejects a level score with PENALTIES but missing penalty numbers', () => {
    expect(() => validateKnockoutResult(result({ homeScore: 1, awayScore: 1, decisionMethod: 'PENALTIES' }), HOME, AWAY)).toThrow(/penalt/i);
  });

  it('rejects equal penalty scores (there must be a winner)', () => {
    expect(() =>
      validateKnockoutResult(
        result({ homeScore: 2, awayScore: 2, decisionMethod: 'PENALTIES', penaltyHome: 4, penaltyAway: 4, winnerEntryId: HOME }),
        HOME,
        AWAY,
      ),
    ).toThrow(/equal/i);
  });

  it('rejects a winner that contradicts the penalty score', () => {
    expect(() =>
      validateKnockoutResult(
        result({ homeScore: 1, awayScore: 1, decisionMethod: 'PENALTIES', penaltyHome: 3, penaltyAway: 5, winnerEntryId: HOME }),
        HOME,
        AWAY,
      ),
    ).toThrow(/winner/i);
  });

  it('rejects penalty data attached to a non-level result (it never went to a shootout)', () => {
    expect(() =>
      validateKnockoutResult(
        result({ homeScore: 2, awayScore: 1, decisionMethod: 'PENALTIES', penaltyHome: 5, penaltyAway: 4, winnerEntryId: HOME }),
        HOME,
        AWAY,
      ),
    ).toThrow(/not.*level|penalt/i);
  });

  it('rejects negative scores', () => {
    expect(() => validateKnockoutResult(result({ homeScore: -1, awayScore: 0, winnerEntryId: AWAY }), HOME, AWAY)).toThrow(/negative/i);
  });
});
