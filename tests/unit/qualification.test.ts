import { describe, it, expect } from 'vitest';
import { calculateQualification, nextPowerOfTwo } from '../../src/domain/qualification/qualification.js';
import type { GroupStandingsInput } from '../../src/domain/qualification/qualification.js';
import type { TeamStanding } from '../../src/domain/standings/standings.js';

function standing(entryId: string, teamName: string, points: number, gd: number): TeamStanding {
  return { entryId, teamName, played: 3, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: gd, points };
}

function group(code: string, standings: TeamStanding[]): GroupStandingsInput {
  return { groupCode: code, standings };
}

describe('nextPowerOfTwo', () => {
  it('maps common counts to the correct target', () => {
    expect(nextPowerOfTwo(8)).toBe(8);
    expect(nextPowerOfTwo(12)).toBe(16);
    expect(nextPowerOfTwo(1)).toBe(1);
    expect(nextPowerOfTwo(0)).toBe(0);
    expect(nextPowerOfTwo(17)).toBe(32);
  });
});

describe('calculateQualification', () => {
  it('four groups -> top two each = 8 automatic qualifiers, no third places needed', () => {
    const groups: GroupStandingsInput[] = ['A', 'B', 'C', 'D'].map((code) =>
      group(code, [
        standing(`${code}1`, `${code}1`, 9, 5),
        standing(`${code}2`, `${code}2`, 6, 2),
        standing(`${code}3`, `${code}3`, 3, -1),
        standing(`${code}4`, `${code}4`, 0, -6),
      ]),
    );

    const result = calculateQualification(groups);
    expect(result.automaticQualifiers).toHaveLength(8);
    expect(result.thirdPlaceQualifiers).toHaveLength(0);
    expect(result.wildcardQualifiers).toHaveLength(0);
    expect(result.targetBracketSize).toBe(8);
    expect(result.shortfall).toBe(false);
    expect(result.allQualifiers).toHaveLength(8);
  });

  it('six groups -> 12 automatic, target 16, best 4 third places qualify', () => {
    const groups: GroupStandingsInput[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((code, i) =>
      group(code, [
        standing(`${code}1`, `${code}1`, 9, 5),
        standing(`${code}2`, `${code}2`, 6, 2),
        // Vary third-place strength per group so ranking is meaningful.
        standing(`${code}3`, `${code}3`, 4 - (i % 3), 3 - i),
        standing(`${code}4`, `${code}4`, 0, -6),
      ]),
    );

    const result = calculateQualification(groups);
    expect(result.automaticQualifiers).toHaveLength(12);
    expect(result.targetBracketSize).toBe(16);
    expect(result.thirdPlaceQualifiers).toHaveLength(4);
    expect(result.wildcardQualifiers).toHaveLength(0);
    expect(result.shortfall).toBe(false);
    expect(result.allQualifiers).toHaveLength(16);

    // All third-place qualifiers must genuinely be 3rd-place finishers.
    for (const q of result.thirdPlaceQualifiers) {
      expect(q.qualificationType).toBe('THIRD_PLACE');
    }
  });

  it('ranks third-place qualifiers by points, then GD, then alphabetical', () => {
    const groups: GroupStandingsInput[] = [
      group('A', [standing('a1', 'A1', 9, 5), standing('a2', 'A2', 6, 2), standing('a3', 'A3', 3, 1), standing('a4', 'A4', 0, -8)]),
      group('B', [standing('b1', 'B1', 9, 5), standing('b2', 'B2', 6, 2), standing('b3', 'B3', 3, 4), standing('b4', 'B4', 0, -11)]),
      group('C', [standing('c1', 'C1', 9, 5), standing('c2', 'C2', 6, 2), standing('c3', 'C3', 3, 1), standing('c4', 'C4', 0, -8)]),
    ];
    // 6 automatic -> target 8 -> need 2 third places from {A3 pts3/gd1, B3 pts3/gd4, C3 pts3/gd1}
    // B3 wins on GD. A3 vs C3 tie on points+GD -> alphabetical: A3 before C3.
    const result = calculateQualification(groups);
    expect(result.targetBracketSize).toBe(8);
    expect(result.thirdPlaceQualifiers).toHaveLength(2);
    expect(result.thirdPlaceQualifiers.map((q) => q.teamName)).toEqual(['B3', 'A3']);
  });

  it('falls back to wildcards (best remaining fourth-place teams) when third places alone cannot reach the target', () => {
    // 5 groups of 4: 10 automatic qualifiers -> target 16 -> only 5
    // third-place candidates exist total (one per group), so after taking
    // all 5, still 1 short -> must pull a labelled WILDCARD from 4th place.
    const codes = ['A', 'B', 'C', 'D', 'E'];
    const groups: GroupStandingsInput[] = codes.map((code) =>
      group(code, [
        standing(`${code}1`, `${code}1`, 9, 5),
        standing(`${code}2`, `${code}2`, 6, 2),
        standing(`${code}3`, `${code}3`, 3, 0),
        standing(`${code}4`, `${code}4`, 1, -3),
      ]),
    );

    const result = calculateQualification(groups);
    expect(result.automaticQualifiers).toHaveLength(10);
    expect(result.targetBracketSize).toBe(16);
    expect(result.thirdPlaceQualifiers).toHaveLength(5); // all 5 third places used
    expect(result.wildcardQualifiers).toHaveLength(1);
    expect(result.wildcardQualifiers[0]!.qualificationType).toBe('WILDCARD');
    expect(result.shortfall).toBe(false);
    expect(result.allQualifiers).toHaveLength(16);
  });

  it('flags shortfall (and never invents a bye) when even wildcards cannot fill the bracket', () => {
    // 5 groups of only 3 teams each (no 4th-place team exists at all):
    // 10 automatic qualifiers -> target 16 -> 5 third-place candidates
    // (index 2, the last position, still exists in a 3-team group) cover 5
    // of the 6 needed, but there is no index-3 "4th place" to draw
    // wildcards from anywhere -> genuinely 1 short. The bracket must be
    // published smaller than the target rather than inventing a bye.
    const codes = ['A', 'B', 'C', 'D', 'E'];
    const groups: GroupStandingsInput[] = codes.map((code) =>
      group(code, [standing(`${code}1`, `${code}1`, 9, 5), standing(`${code}2`, `${code}2`, 6, 2), standing(`${code}3`, `${code}3`, 3, 0)]),
    );

    const result = calculateQualification(groups);
    expect(result.automaticQualifiers).toHaveLength(10);
    expect(result.targetBracketSize).toBe(16);
    expect(result.thirdPlaceQualifiers).toHaveLength(5); // every available third place used
    expect(result.wildcardQualifiers).toHaveLength(0); // nothing left to draw from
    expect(result.shortfall).toBe(true);
    expect(result.allQualifiers).toHaveLength(15); // short of the power-of-two target — never a bye
  });

  it('never produces duplicate qualifiers', () => {
    const groups: GroupStandingsInput[] = ['A', 'B', 'C', 'D', 'E', 'F'].map((code) =>
      group(code, [
        standing(`${code}1`, `${code}1`, 9, 5),
        standing(`${code}2`, `${code}2`, 6, 2),
        standing(`${code}3`, `${code}3`, 3, 0),
        standing(`${code}4`, `${code}4`, 0, -7),
      ]),
    );
    const result = calculateQualification(groups);
    const ids = result.allQualifiers.map((q) => q.entryId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('always outputs a power-of-two allQualifiers count when no shortfall occurred', () => {
    for (const groupCount of [2, 3, 4, 5, 6, 7, 8]) {
      const groups: GroupStandingsInput[] = Array.from({ length: groupCount }, (_, i) =>
        group(String.fromCharCode(65 + i), [
          standing(`g${i}1`, `g${i}1`, 9, 5),
          standing(`g${i}2`, `g${i}2`, 6, 2),
          standing(`g${i}3`, `g${i}3`, 3, 0),
          standing(`g${i}4`, `g${i}4`, 0, -7),
        ]),
      );
      const result = calculateQualification(groups);
      if (!result.shortfall) {
        const size = result.allQualifiers.length;
        expect(Math.log2(size) % 1).toBe(0); // is a power of two
      }
    }
  });

  it('never removes an automatic top-two qualifier', () => {
    const groups: GroupStandingsInput[] = ['A', 'B', 'C'].map((code) =>
      group(code, [
        standing(`${code}1`, `${code}1`, 9, 5),
        standing(`${code}2`, `${code}2`, 6, 2),
        standing(`${code}3`, `${code}3`, 3, 0),
        standing(`${code}4`, `${code}4`, 0, -7),
      ]),
    );
    const result = calculateQualification(groups);
    const autoIds = groups.flatMap((g) => [g.standings[0]!.entryId, g.standings[1]!.entryId]);
    for (const id of autoIds) {
      expect(result.allQualifiers.some((q) => q.entryId === id)).toBe(true);
    }
  });
});
