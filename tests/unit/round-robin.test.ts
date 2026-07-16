import { describe, it, expect } from 'vitest';
import { generateRoundRobinFixtures, defaultRoundTimeOfDay } from '../../src/domain/fixtures/round-robin.js';

describe('generateRoundRobinFixtures', () => {
  it('produces exactly 6 fixtures for 4 teams', () => {
    const fixtures = generateRoundRobinFixtures(['A', 'B', 'C', 'D']);
    expect(fixtures).toHaveLength(6);
  });

  it('produces exactly 3 rounds for 4 teams', () => {
    const fixtures = generateRoundRobinFixtures(['A', 'B', 'C', 'D']);
    const rounds = new Set(fixtures.map((f) => f.round));
    expect(rounds).toEqual(new Set([1, 2, 3]));
  });

  it('every team plays exactly once per round', () => {
    const teams = ['A', 'B', 'C', 'D'];
    const fixtures = generateRoundRobinFixtures(teams);
    for (const round of [1, 2, 3]) {
      const roundFixtures = fixtures.filter((f) => f.round === round);
      const playing = roundFixtures.flatMap((f) => [f.home, f.away]);
      expect(playing.sort()).toEqual([...teams].sort());
    }
  });

  it('every pair of teams meets exactly once', () => {
    const teams = ['A', 'B', 'C', 'D'];
    const fixtures = generateRoundRobinFixtures(teams);
    const pairKey = (a: string, b: string) => [a, b].sort().join('-');
    const seenPairs = new Set<string>();
    for (const fixture of fixtures) {
      const key = pairKey(fixture.home, fixture.away);
      expect(seenPairs.has(key)).toBe(false);
      seenPairs.add(key);
    }
    // C(4,2) = 6 unique pairs for 4 teams.
    expect(seenPairs.size).toBe(6);
  });

  it('throws for an odd number of teams', () => {
    expect(() => generateRoundRobinFixtures(['A', 'B', 'C'])).toThrow();
  });

  it('returns an empty array for zero teams', () => {
    expect(generateRoundRobinFixtures([])).toEqual([]);
  });

  it('scales correctly for 6 teams (5 rounds, 15 fixtures)', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
    const fixtures = generateRoundRobinFixtures(teams);
    expect(fixtures).toHaveLength(15); // C(6,2)
    const rounds = new Set(fixtures.map((f) => f.round));
    expect(rounds.size).toBe(5); // n - 1
    for (const round of rounds) {
      const roundFixtures = fixtures.filter((f) => f.round === round);
      const playing = roundFixtures.flatMap((f) => [f.home, f.away]);
      expect(playing.sort()).toEqual([...teams].sort());
    }
  });
});

describe('defaultRoundTimeOfDay', () => {
  it('maps rounds 1-3 to their configured defaults', () => {
    expect(defaultRoundTimeOfDay(1)).toEqual({ hour: 21, minute: 15 });
    expect(defaultRoundTimeOfDay(2)).toEqual({ hour: 21, minute: 45 });
    expect(defaultRoundTimeOfDay(3)).toEqual({ hour: 22, minute: 10 });
  });

  it('throws for an unsupported round number', () => {
    expect(() => defaultRoundTimeOfDay(4)).toThrow();
  });
});
