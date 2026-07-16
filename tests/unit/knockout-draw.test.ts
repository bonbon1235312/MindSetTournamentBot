import { describe, it, expect } from 'vitest';
import { drawKnockoutPairings } from '../../src/domain/knockouts/knockout-draw.js';

describe('drawKnockoutPairings', () => {
  it('pairs every qualifier exactly once for 8 teams', () => {
    const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    const { pairings } = drawKnockoutPairings(teams, 1);
    expect(pairings).toHaveLength(4);
    const allPaired = pairings.flatMap((p) => [p.home, p.away]);
    expect(allPaired.sort()).toEqual([...teams].sort());
  });

  it('never pairs a team against itself', () => {
    const teams = Array.from({ length: 16 }, (_, i) => `team-${i}`);
    const { pairings } = drawKnockoutPairings(teams, 42);
    for (const pairing of pairings) {
      expect(pairing.home).not.toBe(pairing.away);
    }
  });

  it('is reproducible given the same seed (auditability)', () => {
    const teams = ['A', 'B', 'C', 'D'];
    const a = drawKnockoutPairings(teams, 555);
    const b = drawKnockoutPairings(teams, 555);
    expect(a.pairings).toEqual(b.pairings);
  });

  it('produces a different draw for a different seed (statistically)', () => {
    const teams = Array.from({ length: 12 }, (_, i) => `team-${i}`);
    const a = drawKnockoutPairings(teams, 1);
    const b = drawKnockoutPairings(teams, 2);
    expect(a.shuffledOrder).not.toEqual(b.shuffledOrder);
  });

  it('throws for an odd number of qualifiers (no byes allowed)', () => {
    expect(() => drawKnockoutPairings(['A', 'B', 'C'], 1)).toThrow();
  });

  it('handles a two-team final correctly', () => {
    const { pairings } = drawKnockoutPairings(['Finalist1', 'Finalist2'], 1);
    expect(pairings).toHaveLength(1);
  });
});
