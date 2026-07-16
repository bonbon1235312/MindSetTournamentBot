import { describe, it, expect } from 'vitest';
import { calculateStandings, sortStandings, type TeamStanding } from '../../src/domain/standings/standings.js';

describe('calculateStandings', () => {
  const entries = [
    { entryId: 'a', teamName: 'Alpha' },
    { entryId: 'b', teamName: 'Bravo' },
    { entryId: 'c', teamName: 'Charlie' },
    { entryId: 'd', teamName: 'Delta' },
  ];

  it('awards 3 points for a win, 0 for a loss', () => {
    const standings = calculateStandings(entries, [{ homeEntryId: 'a', awayEntryId: 'b', homeScore: 2, awayScore: 0 }]);
    const a = standings.find((s) => s.entryId === 'a')!;
    const b = standings.find((s) => s.entryId === 'b')!;
    expect(a.points).toBe(3);
    expect(a.wins).toBe(1);
    expect(b.points).toBe(0);
    expect(b.losses).toBe(1);
  });

  it('awards 1 point each for a draw', () => {
    const standings = calculateStandings(entries, [{ homeEntryId: 'a', awayEntryId: 'b', homeScore: 1, awayScore: 1 }]);
    const a = standings.find((s) => s.entryId === 'a')!;
    const b = standings.find((s) => s.entryId === 'b')!;
    expect(a.points).toBe(1);
    expect(a.draws).toBe(1);
    expect(b.points).toBe(1);
    expect(b.draws).toBe(1);
  });

  it('accumulates played/goalsFor/goalsAgainst/goalDifference correctly across multiple fixtures', () => {
    const standings = calculateStandings(entries, [
      { homeEntryId: 'a', awayEntryId: 'b', homeScore: 3, awayScore: 1 },
      { homeEntryId: 'c', awayEntryId: 'a', homeScore: 2, awayScore: 2 },
    ]);
    const a = standings.find((s) => s.entryId === 'a')!;
    expect(a.played).toBe(2);
    expect(a.goalsFor).toBe(5);
    expect(a.goalsAgainst).toBe(3);
    expect(a.goalDifference).toBe(2);
    expect(a.points).toBe(4); // 3 (win) + 1 (draw)
  });

  it('includes teams with zero games played', () => {
    const standings = calculateStandings(entries, [{ homeEntryId: 'a', awayEntryId: 'b', homeScore: 1, awayScore: 0 }]);
    const d = standings.find((s) => s.entryId === 'd')!;
    expect(d.played).toBe(0);
    expect(d.points).toBe(0);
  });
});

describe('sortStandings — exact tiebreaker order (points, GD, alphabetical)', () => {
  function standing(overrides: Partial<TeamStanding>): TeamStanding {
    return {
      entryId: overrides.teamName ?? 'x',
      teamName: 'X',
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      points: 0,
      ...overrides,
    };
  }

  it('ranks by points first', () => {
    const table = [
      standing({ teamName: 'Low', points: 3, goalDifference: 5 }),
      standing({ teamName: 'High', points: 9, goalDifference: -5 }),
    ];
    const sorted = sortStandings(table);
    expect(sorted.map((s) => s.teamName)).toEqual(['High', 'Low']);
  });

  it('breaks a points tie with goal difference', () => {
    const table = [
      standing({ teamName: 'WorseGD', points: 6, goalDifference: 1 }),
      standing({ teamName: 'BetterGD', points: 6, goalDifference: 4 }),
    ];
    const sorted = sortStandings(table);
    expect(sorted.map((s) => s.teamName)).toEqual(['BetterGD', 'WorseGD']);
  });

  it('breaks a points+GD tie alphabetically, case-insensitively', () => {
    const table = [
      standing({ teamName: 'zulu FC', points: 6, goalDifference: 2 }),
      standing({ teamName: 'Alpha FC', points: 6, goalDifference: 2 }),
      standing({ teamName: 'mike FC', points: 6, goalDifference: 2 }),
    ];
    const sorted = sortStandings(table);
    expect(sorted.map((s) => s.teamName)).toEqual(['Alpha FC', 'mike FC', 'zulu FC']);
  });

  it('never uses goals-scored, wins, or head-to-head as a tiebreaker', () => {
    // Same points and GD, but wildly different goals-for and wins — order
    // must be decided by name alone, proving those fields are NOT consulted.
    const table = [
      standing({ teamName: 'Zebra', points: 6, goalDifference: 0, goalsFor: 20, wins: 3 }),
      standing({ teamName: 'Ant', points: 6, goalDifference: 0, goalsFor: 1, wins: 1 }),
    ];
    const sorted = sortStandings(table);
    expect(sorted.map((s) => s.teamName)).toEqual(['Ant', 'Zebra']);
  });

  it('is deterministic and total (a full three-way ranking is stable)', () => {
    const table = [
      standing({ teamName: 'B', points: 4, goalDifference: 0 }),
      standing({ teamName: 'A', points: 7, goalDifference: -2 }),
      standing({ teamName: 'C', points: 4, goalDifference: 3 }),
    ];
    const sorted = sortStandings(table);
    expect(sorted.map((s) => s.teamName)).toEqual(['A', 'C', 'B']);
  });
});
