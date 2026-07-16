import { randomInt } from 'node:crypto';

/** mulberry32 — small, fast, deterministic PRNG. Used so every random draw
 * (group shuffle, knockout draw) can be reproduced later from its stored
 * seed for audit purposes (sections 11/22), which plain Math.random()
 * cannot offer. */
export function createSeededRandom(seed: number): () => number {
  let state = seed | 0;
  return function nextRandom(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateSeed(): number {
  return randomInt(0, 2 ** 31 - 1);
}

/** Unbiased Fisher-Yates shuffle driven by a seeded PRNG. */
export function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rand = createSeededRandom(seed);
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const temp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = temp;
  }
  return arr;
}
