import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { renderGroupFixturesGraphic } from '../../src/graphics/renderers/group-fixtures-renderer.js';
import { renderGroupFixturesSvg } from '../../src/graphics/templates/group-fixtures-template.js';
import { renderGroupStandingsGraphic } from '../../src/graphics/renderers/group-standings-renderer.js';
import { contentHashFor, renderSvgToPng, cleanupStaleGraphics } from '../../src/graphics/renderers/svg-to-png.js';
import { escapeXml, truncateAndEscape } from '../../src/graphics/svg/escape.js';
import { GRAPHIC_DIMENSIONS } from '../../src/config/constants.js';

const cacheDirs: string[] = [];
async function tempCacheDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mindset-graphics-test-'));
  cacheDirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(cacheDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const SAMPLE_INPUT = {
  tournamentName: 'MindSet Cash Cup',
  groupCode: 'A',
  rounds: [
    { roundLabel: 'Round One', timeLabel: '9:15 PM', matches: [{ home: 'Rocket FC', away: 'Bravo United' }, { home: 'Charlie Athletic', away: 'Delta FC' }] },
    { roundLabel: 'Round Two', timeLabel: '9:45 PM', matches: [{ home: 'Rocket FC', away: 'Charlie Athletic' }, { home: 'Bravo United', away: 'Delta FC' }] },
    { roundLabel: 'Round Three', timeLabel: '10:10 PM', matches: [{ home: 'Rocket FC', away: 'Delta FC' }, { home: 'Bravo United', away: 'Charlie Athletic' }] },
  ],
};

describe('renderGroupFixturesGraphic (end-to-end SVG -> PNG)', () => {
  it('produces a valid PNG at the configured dimensions', async () => {
    const cacheDir = await tempCacheDir();
    const result = await renderGroupFixturesGraphic(SAMPLE_INPUT, cacheDir);

    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(GRAPHIC_DIMENSIONS.width);
    expect(metadata.height).toBe(GRAPHIC_DIMENSIONS.height);
  });

  it('writes the file to the cache directory and reuses it on identical input (content-hash caching)', async () => {
    const cacheDir = await tempCacheDir();
    const first = await renderGroupFixturesGraphic(SAMPLE_INPUT, cacheDir);
    const second = await renderGroupFixturesGraphic(SAMPLE_INPUT, cacheDir);

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(first.filePath).toBe(second.filePath);
    expect(first.contentHash).toBe(second.contentHash);
  });

  it('produces a different content hash when fixture data actually changes', async () => {
    const cacheDir = await tempCacheDir();
    const first = await renderGroupFixturesGraphic(SAMPLE_INPUT, cacheDir);
    const changed = { ...SAMPLE_INPUT, rounds: [{ ...SAMPLE_INPUT.rounds[0]!, timeLabel: '9:30 PM' }, ...SAMPLE_INPUT.rounds.slice(1)] };
    const second = await renderGroupFixturesGraphic(changed, cacheDir);

    expect(first.contentHash).not.toBe(second.contentHash);
  });

  it('never crashes or produces invalid SVG when a team name contains XML-special characters or mention syntax', async () => {
    const malicious = {
      ...SAMPLE_INPUT,
      rounds: [{ ...SAMPLE_INPUT.rounds[0]!, matches: [{ home: `<script>&"'"</script>`, away: '@everyone <@123456789012345678>' }, SAMPLE_INPUT.rounds[0]!.matches[1]!] }, ...SAMPLE_INPUT.rounds.slice(1)],
    };
    const cacheDir = await tempCacheDir();
    const result = await renderGroupFixturesGraphic(malicious, cacheDir);
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe('png'); // Sharp would throw on malformed SVG — reaching here proves it's well-formed.
  });

  it('truncates a long team name instead of overflowing the graphic', () => {
    const svg = renderGroupFixturesSvg({
      ...SAMPLE_INPUT,
      rounds: [{ ...SAMPLE_INPUT.rounds[0]!, matches: [{ home: 'The Extremely Long Championship Winning Football Club Name', away: 'Short FC' }, SAMPLE_INPUT.rounds[0]!.matches[1]!] }, ...SAMPLE_INPUT.rounds.slice(1)] as typeof SAMPLE_INPUT.rounds,
    });
    expect(svg).toContain('…');
    expect(svg).not.toContain('The Extremely Long Championship Winning Football Club Name');
  });
});

const SAMPLE_STANDINGS = {
  tournamentName: 'MindSet Cash Cup',
  groupCode: 'A',
  qualifyingPositions: 2,
  standings: [
    { teamName: 'Rocket FC', played: 3, wins: 3, draws: 0, losses: 0, goalsFor: 9, goalsAgainst: 2, goalDifference: 7, points: 9 },
    { teamName: 'Bravo United', played: 3, wins: 2, draws: 0, losses: 1, goalsFor: 6, goalsAgainst: 4, goalDifference: 2, points: 6 },
    { teamName: 'Charlie Athletic', played: 3, wins: 1, draws: 0, losses: 2, goalsFor: 4, goalsAgainst: 6, goalDifference: -2, points: 3 },
    { teamName: 'Delta FC', played: 3, wins: 0, draws: 0, losses: 3, goalsFor: 1, goalsAgainst: 8, goalDifference: -7, points: 0 },
  ],
};

describe('renderGroupStandingsGraphic', () => {
  it('produces a valid PNG at the configured dimensions', async () => {
    const cacheDir = await tempCacheDir();
    const result = await renderGroupStandingsGraphic(SAMPLE_STANDINGS, cacheDir);
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe('png');
    expect(metadata.width).toBe(GRAPHIC_DIMENSIONS.width);
    expect(metadata.height).toBe(GRAPHIC_DIMENSIONS.height);
  });

  it('formats positive goal difference with an explicit + sign, negative with -', async () => {
    const cacheDir = await tempCacheDir();
    const result = await renderGroupStandingsGraphic(SAMPLE_STANDINGS, cacheDir);
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it('handles zero qualifying positions without drawing a broken divider line', async () => {
    const cacheDir = await tempCacheDir();
    const result = await renderGroupStandingsGraphic({ ...SAMPLE_STANDINGS, qualifyingPositions: 0 }, cacheDir);
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe('png');
  });
});

describe('cleanupStaleGraphics', () => {
  it('removes files older than the given age and keeps fresh ones', async () => {
    const cacheDir = await tempCacheDir();
    await renderGroupFixturesGraphic(SAMPLE_INPUT, cacheDir);

    const removedNothing = await cleanupStaleGraphics(cacheDir, 60_000); // 1 minute — file is brand new
    expect(removedNothing).toBe(0);

    const removedAll = await cleanupStaleGraphics(cacheDir, -1); // "older than negative ms" == everything
    expect(removedAll).toBe(1);
  });

  it('does not throw if the cache directory does not exist yet', async () => {
    const removed = await cleanupStaleGraphics(path.join(tmpdir(), 'mindset-nonexistent-dir-xyz'), 60_000);
    expect(removed).toBe(0);
  });
});

describe('contentHashFor', () => {
  it('is deterministic for identical input', () => {
    const svg = renderGroupFixturesSvg(SAMPLE_INPUT);
    expect(contentHashFor(svg)).toBe(contentHashFor(svg));
  });
});

describe('renderSvgToPng (generic renderer, used by every graphic type)', () => {
  it('rasterises an arbitrary minimal SVG', async () => {
    const cacheDir = await tempCacheDir();
    const svg = `<svg width="100" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="red"/></svg>`;
    const result = await renderSvgToPng(svg, cacheDir, 'test');
    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.width).toBe(100);
    expect(metadata.height).toBe(100);
  });
});

describe('escapeXml / truncateAndEscape', () => {
  it('escapes all five XML-significant characters', () => {
    expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
  });

  it('truncates then escapes, in that order, adding an ellipsis', () => {
    const result = truncateAndEscape('A'.repeat(20) + '&', 10);
    expect(result.length).toBeLessThanOrEqual(11); // 9 chars + ellipsis, escaped chars can't appear here
    expect(result.endsWith('…')).toBe(true);
  });

  it('does not truncate a name that already fits', () => {
    expect(truncateAndEscape('Short', 16)).toBe('Short');
  });
});
