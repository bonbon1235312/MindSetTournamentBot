import { describe, it, expect } from 'vitest';
import { seededShuffle, createSeededRandom, generateSeed } from '../../src/utils/seeded-random.js';

describe('seededShuffle', () => {
  it('is reproducible given the same seed', () => {
    const items = Array.from({ length: 20 }, (_, i) => i);
    const a = seededShuffle(items, 12345);
    const b = seededShuffle(items, 12345);
    expect(a).toEqual(b);
  });

  it('produces a different order for a different seed (statistically)', () => {
    const items = Array.from({ length: 30 }, (_, i) => i);
    const a = seededShuffle(items, 1);
    const b = seededShuffle(items, 2);
    expect(a).not.toEqual(b);
  });

  it('never loses or duplicates an element', () => {
    const items = Array.from({ length: 50 }, (_, i) => `item-${i}`);
    const shuffled = seededShuffle(items, 999);
    expect(shuffled).toHaveLength(items.length);
    expect(new Set(shuffled)).toEqual(new Set(items));
  });

  it('does not mutate the input array', () => {
    const items = [1, 2, 3, 4, 5];
    const copy = [...items];
    seededShuffle(items, 42);
    expect(items).toEqual(copy);
  });

  it('is approximately unbiased: every position is reachable by every element across many seeds', () => {
    // Fisher-Yates bias-check: track how often element 0 lands in each
    // final position across many independent seeds; every position should
    // get roughly the same share (not a rigorous chi-square test, just a
    // sanity bound against a badly-biased shuffle implementation).
    const n = 6;
    const trials = 3000;
    const positionCounts = new Array(n).fill(0) as number[];

    for (let seed = 0; seed < trials; seed++) {
      const shuffled = seededShuffle([0, 1, 2, 3, 4, 5], seed * 7919 + 1);
      const pos = shuffled.indexOf(0);
      positionCounts[pos]! += 1;
    }

    const expected = trials / n;
    for (const count of positionCounts) {
      expect(count).toBeGreaterThan(expected * 0.7);
      expect(count).toBeLessThan(expected * 1.3);
    }
  });

  it('does not preserve original ordering (regression guard against a no-op shuffle)', () => {
    const items = Array.from({ length: 40 }, (_, i) => i);
    const shuffled = seededShuffle(items, 55555);
    expect(shuffled).not.toEqual(items);
  });
});

describe('createSeededRandom', () => {
  it('produces values in [0, 1)', () => {
    const rand = createSeededRandom(777);
    for (let i = 0; i < 100; i++) {
      const v = rand();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    const seqA = Array.from({ length: 10 }, () => a());
    const seqB = Array.from({ length: 10 }, () => b());
    expect(seqA).toEqual(seqB);
  });
});

describe('generateSeed', () => {
  it('produces an integer within the expected range', () => {
    const seed = generateSeed();
    expect(Number.isInteger(seed)).toBe(true);
    expect(seed).toBeGreaterThanOrEqual(0);
    expect(seed).toBeLessThan(2 ** 31);
  });
});
