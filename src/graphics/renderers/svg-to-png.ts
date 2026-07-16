import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export interface RenderedGraphic {
  buffer: Buffer;
  filePath: string;
  contentHash: string;
  /** true if an existing cached file was reused instead of re-rendering. */
  cacheHit: boolean;
}

/** SHA-256 of the SVG source — identical inputs (e.g. re-rendering a group
 * whose fixtures haven't changed) always produce the same hash, so callers
 * can skip a duplicate render/upload entirely (section 14/25). */
export function contentHashFor(svg: string): string {
  return createHash('sha256').update(svg).digest('hex').slice(0, 16);
}

/**
 * Rasterises an SVG string to PNG via Sharp and caches the result on disk
 * under `<cacheDir>/<prefix>-<contentHash>.png`. If a file for that exact
 * hash already exists, it's reused instead of re-rendering (section 14:
 * "Use caching and content hashes to avoid unnecessary duplicate
 * rendering").
 */
export async function renderSvgToPng(svg: string, cacheDir: string, prefix: string): Promise<RenderedGraphic> {
  await mkdir(cacheDir, { recursive: true });

  const contentHash = contentHashFor(svg);
  const filePath = path.join(cacheDir, `${prefix}-${contentHash}.png`);

  try {
    const existing = await readFile(filePath);
    return { buffer: existing, filePath, contentHash, cacheHit: true };
  } catch {
    // Not cached yet — fall through to render.
  }

  const buffer = await sharp(Buffer.from(svg)).png().toBuffer();
  await writeFile(filePath, buffer);
  return { buffer, filePath, contentHash, cacheHit: false };
}

/**
 * Deletes cached graphic files older than `maxAgeMs` (section 14: "Clean
 * stale cached files"; section 33 calls this during midnight cleanup).
 * Returns the number of files removed.
 */
export async function cleanupStaleGraphics(cacheDir: string, maxAgeMs: number): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(cacheDir);
  } catch {
    return 0; // cache dir doesn't exist yet — nothing to clean.
  }

  const now = Date.now();
  let removed = 0;
  for (const entry of entries) {
    if (!entry.endsWith('.png')) continue;
    const filePath = path.join(cacheDir, entry);
    const stats = await stat(filePath);
    if (now - stats.mtimeMs > maxAgeMs) {
      await unlink(filePath);
      removed += 1;
    }
  }
  return removed;
}
