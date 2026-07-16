import { MINDSET_LOGO_DATA_URI } from './logo.js';

/** Safe font fallback stack (section 14) — every font here is present on
 * virtually any rendering environment libvips/Sharp runs on. */
export const FONT_STACK = "'Arial', 'Helvetica Neue', 'Segoe UI', 'DejaVu Sans', sans-serif";

/**
 * Deliberately monochrome — matches the MindSet shield logo's black/chrome
 * look. This palette is scoped to the graphics pipeline only; it's
 * independent of DEFAULT_BRANDING (config/constants.ts), which still
 * drives Discord embed accent colors elsewhere in the bot.
 */
export interface BrandColors {
  text: string;
  accent: string;
  muted: string;
  cardFill: string;
  cardFillHighlight: string;
  cardStroke: string;
}

export const BRAND: BrandColors = {
  text: '#FFFFFF',
  accent: '#D8D8D8',
  muted: '#8A8A8A',
  cardFill: '#141414',
  cardFillHighlight: '#1F1F1F',
  cardStroke: '#3A3A3A',
};

/** Full-bleed near-black background with a faint radial vignette, shared
 * by every graphic template so the whole graphic family reads as one
 * consistent, monochrome brand (section 14: "Consistent MindSet branding"). */
export function svgBackground(width: number, height: number): string {
  return `
    <defs>
      <radialGradient id="bg" cx="50%" cy="38%" r="75%">
        <stop offset="0%" stop-color="#0D0D0D" />
        <stop offset="100%" stop-color="#000000" />
      </radialGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)" />
  `;
}

/** Places the MindSet shield logo, centered on (cx, cy), at the given
 * square size — used in the header of every graphic template. */
export function svgLogo(cx: number, cy: number, size: number): string {
  return `<image href="${MINDSET_LOGO_DATA_URI}" x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" />`;
}

/** Bottom brand strip present on every generated graphic. */
export function svgFooter(width: number, height: number, label: string): string {
  const barY = height - 48;
  return `
    <rect x="0" y="${barY}" width="${width}" height="3" fill="${BRAND.accent}" opacity="0.6" />
    <text x="${width / 2}" y="${height - 18}" text-anchor="middle"
      font-family="${FONT_STACK}" font-size="22" font-weight="700"
      fill="${BRAND.text}" letter-spacing="2">MINDSET TOURNAMENT BOT  ·  ${escapeAttr(label)}</text>
  `;
}

function escapeAttr(input: string): string {
  return input.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function svgDocument(width: number, height: number, body: string): string {
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
}
