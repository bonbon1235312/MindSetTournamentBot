import { describe, it, expect } from 'vitest';
import { generateGroups, groupCodeForIndex, canFormAdditionalGroup } from '../../src/domain/groups/group-generation.js';

function entries(n: number): { id: string }[] {
  return Array.from({ length: n }, (_, i) => ({ id: `entry-${i}` }));
}

describe('generateGroups', () => {
  it('produces exact groups of four for 16 eligible teams', () => {
    const result = generateGroups(entries(16), 1);
    expect(result.groups).toHaveLength(4);
    for (const group of result.groups) {
      expect(group.entries).toHaveLength(4);
    }
    expect(result.reserves).toHaveLength(0);
  });

  it('produces four groups and two reserves for 18 eligible teams', () => {
    const result = generateGroups(entries(18), 2);
    expect(result.groups).toHaveLength(4);
    expect(result.reserves).toHaveLength(2);
  });

  it('produces five groups for 20 eligible teams', () => {
    const result = generateGroups(entries(20), 3);
    expect(result.groups).toHaveLength(5);
    expect(result.reserves).toHaveLength(0);
  });

  it('produces five groups and three reserves for 23 eligible teams', () => {
    const result = generateGroups(entries(23), 4);
    expect(result.groups).toHaveLength(5);
    expect(result.reserves).toHaveLength(3);
  });

  it('produces six groups for 24 eligible teams', () => {
    const result = generateGroups(entries(24), 5);
    expect(result.groups).toHaveLength(6);
    expect(result.reserves).toHaveLength(0);
  });

  it('never creates a group of two or three', () => {
    for (let n = 1; n <= 30; n++) {
      const result = generateGroups(entries(n), n * 13);
      for (const group of result.groups) {
        expect(group.entries.length).toBe(4);
      }
    }
  });

  it('includes every entry exactly once across groups + reserves (no duplicate, no missing)', () => {
    const input = entries(22);
    const result = generateGroups(input, 999);
    const allOut = [...result.groups.flatMap((g) => g.entries), ...result.reserves];
    expect(allOut).toHaveLength(input.length);
    const ids = allOut.map((e) => e.id).sort();
    const expectedIds = input.map((e) => e.id).sort();
    expect(ids).toEqual(expectedIds);
  });

  it('randomisation does not preserve entry (signup) ordering', () => {
    const input = entries(16);
    const result = generateGroups(input, 42);
    expect(result.shuffledOrder.map((e) => e.id)).not.toEqual(input.map((e) => e.id));
  });

  it('is reproducible given the same seed (auditability)', () => {
    const input = entries(16);
    const a = generateGroups(input, 2024);
    const b = generateGroups(input, 2024);
    expect(a.shuffledOrder).toEqual(b.shuffledOrder);
    expect(a.groups).toEqual(b.groups);
  });

  it('handles zero eligible entries without error', () => {
    const result = generateGroups(entries(0), 1);
    expect(result.groups).toHaveLength(0);
    expect(result.reserves).toHaveLength(0);
  });
});

describe('groupCodeForIndex', () => {
  it('names groups A, B, C ...', () => {
    expect(groupCodeForIndex(0)).toBe('A');
    expect(groupCodeForIndex(1)).toBe('B');
    expect(groupCodeForIndex(25)).toBe('Z');
  });

  it('continues into AA, AB, AC beyond 26 groups', () => {
    expect(groupCodeForIndex(26)).toBe('AA');
    expect(groupCodeForIndex(27)).toBe('AB');
    expect(groupCodeForIndex(51)).toBe('AZ');
    expect(groupCodeForIndex(52)).toBe('BA');
  });
});

describe('canFormAdditionalGroup', () => {
  it('is true once reserves reach four', () => {
    expect(canFormAdditionalGroup(4)).toBe(true);
    expect(canFormAdditionalGroup(5)).toBe(true);
  });

  it('is false below four reserves', () => {
    expect(canFormAdditionalGroup(0)).toBe(false);
    expect(canFormAdditionalGroup(3)).toBe(false);
  });
});
