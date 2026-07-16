import type { DecisionMethod } from '../../database/schema/enums.js';

export interface CanonicalResult {
  homeScore: number;
  awayScore: number;
  decisionMethod: DecisionMethod | null;
  penaltyHome: number | null;
  penaltyAway: number | null;
  winnerEntryId: string | null;
}

export interface RawSubmission {
  /** The entry that submitted this result. */
  submittingEntryId: string;
  /** Score of the submitter's OWN team, as they entered it. */
  scoreForSubmitter: number;
  /** Score of the opponent, as the submitter entered it. */
  scoreForOpponent: number;
  decisionMethod?: DecisionMethod;
  penaltyForSubmitter?: number;
  penaltyForOpponent?: number;
}

/**
 * Section 18: "Canonical fixture orientation must always be home/away
 * score... normalise the input so matching works correctly" regardless of
 * which side submitted. This is the normalisation step — it does NOT
 * validate knockout-specific rules (see result-validation.ts for that).
 */
export function normalizeSubmission(
  submission: RawSubmission,
  homeEntryId: string,
  awayEntryId: string,
): CanonicalResult {
  const isHomeSubmitter = submission.submittingEntryId === homeEntryId;
  if (!isHomeSubmitter && submission.submittingEntryId !== awayEntryId) {
    throw new Error('submittingEntryId does not match either side of the fixture.');
  }

  const homeScore = isHomeSubmitter ? submission.scoreForSubmitter : submission.scoreForOpponent;
  const awayScore = isHomeSubmitter ? submission.scoreForOpponent : submission.scoreForSubmitter;

  const penaltyForSubmitter = submission.penaltyForSubmitter ?? null;
  const penaltyForOpponent = submission.penaltyForOpponent ?? null;
  const penaltyHome = isHomeSubmitter ? penaltyForSubmitter : penaltyForOpponent;
  const penaltyAway = isHomeSubmitter ? penaltyForOpponent : penaltyForSubmitter;

  const decisionMethod = submission.decisionMethod ?? null;

  let winnerEntryId: string | null = null;
  if (homeScore !== awayScore) {
    winnerEntryId = homeScore > awayScore ? homeEntryId : awayEntryId;
  } else if (decisionMethod === 'PENALTIES' && penaltyHome !== null && penaltyAway !== null) {
    winnerEntryId = penaltyHome > penaltyAway ? homeEntryId : awayEntryId;
  }

  return { homeScore, awayScore, decisionMethod, penaltyHome, penaltyAway, winnerEntryId };
}

/** Section 18: "Scores match" -> silent auto-resolve. Compares every field
 * that matters, not just the raw score. */
export function submissionsMatch(a: CanonicalResult, b: CanonicalResult): boolean {
  return (
    a.homeScore === b.homeScore &&
    a.awayScore === b.awayScore &&
    a.decisionMethod === b.decisionMethod &&
    a.penaltyHome === b.penaltyHome &&
    a.penaltyAway === b.penaltyAway
  );
}
