import type { TeamStanding } from '../standings/standings.js';

export type QualificationType = 'AUTOMATIC' | 'THIRD_PLACE' | 'WILDCARD';

export interface QualifiedTeam {
  entryId: string;
  teamName: string;
  groupCode: string;
  points: number;
  goalDifference: number;
  qualificationType: QualificationType;
}

export interface GroupStandingsInput {
  groupCode: string;
  /** Already sorted via standings.sortStandings — position 0 is 1st place. */
  standings: TeamStanding[];
}

export interface QualificationResult {
  automaticQualifiers: QualifiedTeam[];
  thirdPlaceQualifiers: QualifiedTeam[];
  wildcardQualifiers: QualifiedTeam[];
  targetBracketSize: number;
  /** True only when even every available team across every group still
   * couldn't reach targetBracketSize (extremely small tournaments) — the
   * bracket will be smaller than targetBracketSize and staff must be
   * warned (section 21, item 5: "Post a staff warning"). */
  shortfall: boolean;
  allQualifiers: QualifiedTeam[];
}

/** Smallest power of two >= n (section 21). nextPowerOfTwo(0) is defined as
 * 0 — an empty qualifier list needs no bracket. */
export function nextPowerOfTwo(n: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  return 2 ** Math.ceil(Math.log2(n));
}

function rankCandidatesByGroupPosition(
  groupStandings: readonly GroupStandingsInput[],
  positionIndex: number,
  qualificationType: QualificationType,
): QualifiedTeam[] {
  const candidates: QualifiedTeam[] = [];
  for (const group of groupStandings) {
    const standing = group.standings[positionIndex];
    if (!standing) continue;
    candidates.push({
      entryId: standing.entryId,
      teamName: standing.teamName,
      groupCode: group.groupCode,
      points: standing.points,
      goalDifference: standing.goalDifference,
      qualificationType,
    });
  }

  // Same tiebreaker order as section 20: points, GD, alphabetical.
  return candidates.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return a.teamName.toLowerCase().localeCompare(b.teamName.toLowerCase());
  });
}

/**
 * Section 21's full qualification engine, including the mandatory
 * no-byes safety fallback:
 *   1. Top `autoQualifiersPerGroup` from every group qualify automatically.
 *   2. Fill up to the next power of two with the best third-place teams
 *      (ranked across all groups by points/GD/alphabetical).
 *   3. If STILL short (extremely small tournaments), fall back to the best
 *      remaining fourth-place teams as explicitly-labelled WILDCARDs.
 *   4. If even that can't reach the target, the bracket is intentionally
 *      SMALLER than the next power of two (still power-of-two among itself
 *      is not guaranteed at that point — this is the documented edge case
 *      the spec asks to surface via a staff warning) rather than ever
 *      inventing a bye.
 */
export function calculateQualification(
  groupStandings: readonly GroupStandingsInput[],
  autoQualifiersPerGroup = 2,
): QualificationResult {
  const autoList: QualifiedTeam[] = [];
  for (let slot = 0; slot < autoQualifiersPerGroup; slot++) {
    for (const group of groupStandings) {
      const standing = group.standings[slot];
      if (!standing) continue;
      autoList.push({
        entryId: standing.entryId,
        teamName: standing.teamName,
        groupCode: group.groupCode,
        points: standing.points,
        goalDifference: standing.goalDifference,
        qualificationType: 'AUTOMATIC',
      });
    }
  }

  const targetBracketSize = nextPowerOfTwo(autoList.length);
  let remaining = targetBracketSize - autoList.length;

  const thirdPlaceQualifiers: QualifiedTeam[] = [];
  if (remaining > 0) {
    const thirdPlaceCandidates = rankCandidatesByGroupPosition(groupStandings, autoQualifiersPerGroup, 'THIRD_PLACE');
    thirdPlaceQualifiers.push(...thirdPlaceCandidates.slice(0, remaining));
    remaining -= thirdPlaceQualifiers.length;
  }

  const wildcardQualifiers: QualifiedTeam[] = [];
  if (remaining > 0) {
    const wildcardCandidates = rankCandidatesByGroupPosition(groupStandings, autoQualifiersPerGroup + 1, 'WILDCARD');
    wildcardQualifiers.push(...wildcardCandidates.slice(0, remaining));
    remaining -= wildcardQualifiers.length;
  }

  return {
    automaticQualifiers: autoList,
    thirdPlaceQualifiers,
    wildcardQualifiers,
    targetBracketSize,
    shortfall: remaining > 0,
    allQualifiers: [...autoList, ...thirdPlaceQualifiers, ...wildcardQualifiers],
  };
}
