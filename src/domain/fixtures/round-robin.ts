import { DEFAULT_SCHEDULE } from '../../config/constants.js';

export interface RoundRobinFixture<T> {
  round: number; // 1-indexed
  home: T;
  away: T;
}

/**
 * Deterministic round-robin "circle method" (section 13): fixes the first
 * team and rotates the rest each round. For 4 teams this produces exactly
 * 3 rounds of 2 matches — every team plays once per round, every pair
 * meets exactly once, 6 total fixtures. Works for any even team count, but
 * this system only ever calls it with groups of 4.
 */
export function generateRoundRobinFixtures<T>(teams: readonly T[]): RoundRobinFixture<T>[] {
  if (teams.length % 2 !== 0) {
    throw new Error('Round-robin requires an even number of teams.');
  }
  if (teams.length === 0) return [];

  const n = teams.length;
  let rotation = [...teams];
  const fixtures: RoundRobinFixture<T>[] = [];

  for (let round = 0; round < n - 1; round++) {
    for (let i = 0; i < n / 2; i++) {
      const home = rotation[i]!;
      const away = rotation[n - 1 - i]!;
      fixtures.push({ round: round + 1, home, away });
    }
    // Keep index 0 fixed, rotate everyone else one position clockwise.
    rotation = [rotation[0]!, rotation[n - 1]!, ...rotation.slice(1, n - 1)];
  }

  return fixtures;
}

/** Maps round number (1/2/3) to its default scheduled time-of-day, per
 * section 13's defaults (overridable via the tournament's stored schedule
 * in practice — this is only the fallback). */
export function defaultRoundTimeOfDay(round: number): { hour: number; minute: number } {
  switch (round) {
    case 1:
      return DEFAULT_SCHEDULE.roundOne;
    case 2:
      return DEFAULT_SCHEDULE.roundTwo;
    case 3:
      return DEFAULT_SCHEDULE.roundThree;
    default:
      throw new Error(`No default time for round ${round}`);
  }
}
