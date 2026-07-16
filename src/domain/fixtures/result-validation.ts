import { ValidationError } from '../../types/errors.js';
import type { CanonicalResult } from './result-matching.js';

/**
 * Section 24's exact knockout validation rules. Group fixtures do NOT go
 * through this — group draws are explicitly allowed (section 18).
 *
 * - Level score -> decision method MUST be PENALTIES, with a non-equal
 *   penalty score, and the winner must match the penalty score.
 * - Non-level score -> winner is derived from the score, and providing
 *   penalty data is invalid (it wasn't a shootout).
 */
export function validateKnockoutResult(result: CanonicalResult, homeEntryId: string, awayEntryId: string): void {
  if (result.homeScore < 0 || result.awayScore < 0) {
    throw new ValidationError('Scores cannot be negative.');
  }

  const isLevel = result.homeScore === result.awayScore;

  if (isLevel) {
    if (result.decisionMethod !== 'PENALTIES') {
      throw new ValidationError('Knockout matches cannot end in a draw — if the score is level, the decision method must be penalties.');
    }
    if (result.penaltyHome === null || result.penaltyAway === null) {
      throw new ValidationError('Penalty scores are required when the match went to a shootout.');
    }
    if (result.penaltyHome === result.penaltyAway) {
      throw new ValidationError('Penalty scores cannot be equal — there must be a winner.');
    }
    const expectedWinner = result.penaltyHome > result.penaltyAway ? homeEntryId : awayEntryId;
    if (result.winnerEntryId !== expectedWinner) {
      throw new ValidationError('The declared winner does not match the penalty score.');
    }
  } else {
    if (result.decisionMethod === 'PENALTIES' || result.penaltyHome !== null || result.penaltyAway !== null) {
      throw new ValidationError('Penalty data was provided but the match was not level — it did not go to penalties.');
    }
    const expectedWinner = result.homeScore > result.awayScore ? homeEntryId : awayEntryId;
    if (result.winnerEntryId !== expectedWinner) {
      throw new ValidationError('The declared winner does not match the score.');
    }
  }
}
