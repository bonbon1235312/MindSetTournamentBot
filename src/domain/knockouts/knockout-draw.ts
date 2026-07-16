import { generateSeed, seededShuffle } from '../../utils/seeded-random.js';

export interface KnockoutPairing<T> {
  home: T;
  away: T;
}

export interface KnockoutDrawResult<T> {
  pairings: KnockoutPairing<T>[];
  seed: number;
  shuffledOrder: T[];
}

/**
 * Section 22: completely random knockout draw — no seeding, no protecting
 * group winners, no avoiding rematches. Requires an even (power-of-two)
 * input; qualification.ts is responsible for guaranteeing that upstream.
 */
export function drawKnockoutPairings<T>(qualifiers: readonly T[], seed: number = generateSeed()): KnockoutDrawResult<T> {
  if (qualifiers.length % 2 !== 0) {
    throw new Error('Knockout draw requires an even number of qualifiers.');
  }

  const shuffled = seededShuffle(qualifiers, seed);
  const pairings: KnockoutPairing<T>[] = [];
  for (let i = 0; i < shuffled.length; i += 2) {
    pairings.push({ home: shuffled[i]!, away: shuffled[i + 1]! });
  }

  return { pairings, seed, shuffledOrder: shuffled };
}
