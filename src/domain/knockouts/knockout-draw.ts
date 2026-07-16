import { generateSeed, seededShuffle } from '../../utils/seeded-random.js';
import type { Stage } from '../../database/schema/enums.js';

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

const STAGE_BY_ENTRANT_COUNT: Record<number, Stage> = {
  64: 'ROUND_OF_64',
  32: 'ROUND_OF_32',
  16: 'ROUND_OF_16',
  8: 'QUARTER_FINAL',
  4: 'SEMI_FINAL',
  2: 'FINAL',
};

/** Maps "how many teams are entering this knockout round" to its stage
 * label (section 23). Only defined for powers of two from 2 to 64 — the
 * qualification shortfall edge case (an odd/non-power-of-two count that
 * still couldn't be filled) must be resolved to an even number by the
 * caller before this is reached. */
export function stageForEntrantCount(entrantCount: number): Stage {
  const stage = STAGE_BY_ENTRANT_COUNT[entrantCount];
  if (!stage) {
    throw new Error(`No knockout stage defined for ${entrantCount} entrants — expected a power of two from 2 to 64.`);
  }
  return stage;
}

/** Human-readable label for every stage — shared by the Discord resource
 * service (category/role/channel names) and the bracket graphic/pings, so
 * the two never drift apart. */
export const STAGE_LABELS: Record<Stage, string> = {
  GROUP: 'Group',
  ROUND_OF_64: 'Round of 64',
  ROUND_OF_32: 'Round of 32',
  ROUND_OF_16: 'Round of 16',
  QUARTER_FINAL: 'Quarter Finals',
  SEMI_FINAL: 'Semi Finals',
  FINAL: 'Final',
};
