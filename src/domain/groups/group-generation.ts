import { GROUP_SIZE } from '../../config/constants.js';
import { generateSeed, seededShuffle } from '../../utils/seeded-random.js';

/** Excel-column-style naming: 0->A, 25->Z, 26->AA, 27->AB, ... (section 11). */
export function groupCodeForIndex(index: number): string {
  let n = index;
  let code = '';
  do {
    code = String.fromCharCode(65 + (n % 26)) + code;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return code;
}

export interface GroupAssignment<T> {
  groupCode: string;
  entries: T[];
}

export interface GroupGenerationResult<T> {
  groups: GroupAssignment<T>[];
  reserves: T[];
  seed: number;
  shuffledOrder: T[];
}

/**
 * Randomly shuffles eligible entries and slices them into complete groups
 * of exactly GROUP_SIZE (4), with any remainder becoming reserves (section
 * 11). Never produces a group of 2 or 3 — Math.floor naturally drops the
 * remainder to reserves instead. Pass an explicit seed to reproduce a draw
 * (e.g. re-running the exact same test case); omit it to draw fresh.
 */
export function generateGroups<T>(eligibleEntries: readonly T[], seed: number = generateSeed()): GroupGenerationResult<T> {
  const shuffled = seededShuffle(eligibleEntries, seed);
  const fullGroupCount = Math.floor(shuffled.length / GROUP_SIZE);

  const groups: GroupAssignment<T>[] = [];
  for (let g = 0; g < fullGroupCount; g++) {
    groups.push({
      groupCode: groupCodeForIndex(g),
      entries: shuffled.slice(g * GROUP_SIZE, (g + 1) * GROUP_SIZE),
    });
  }

  const reserves = shuffled.slice(fullGroupCount * GROUP_SIZE);

  return { groups, reserves, seed, shuffledOrder: shuffled };
}

/** Section 11: "If four reserve teams become eligible before group
 * publication completes, create another complete group." */
export function canFormAdditionalGroup(reserveCount: number): boolean {
  return reserveCount >= GROUP_SIZE;
}
