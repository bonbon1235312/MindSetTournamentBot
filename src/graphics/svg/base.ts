import { DEFAULT_BRANDING } from '../../config/constants.js';

/** Safe font fallback stack (section 14) — every font here is present on
 * virtually any rendering environment libvips/Sharp runs on. */
export const FONT_STACK = "'Arial', 'Helvetica Neue', 'Segoe UI', 'DejaVu Sans', sans-serif";

export interface BrandColors {
  primary: string;
  accent: string;
  success: string;
  danger: string;
  text: string;
}

export const BRAND: BrandColors = {
  primary: DEFAULT_BRANDING.primaryColor,
  accent: DEFAULT_BRANDING.accentColor,
  success: DEFAULT_BRANDING.successColor,
  danger: DEFAULT_BRANDING.dangerColor,
  text: DEFAULT_BRANDING.textColor,
};

/** Full-bleed diagonal gradient background, shared by every graphic
 * template so the whole graphic family reads as one consistent brand
 * (section 14: "Consistent MindSet branding"). */
export function svgBackground(width: number, height: number): string {
  return `
    <defs>
      <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#0B1F3A" />
        <stop offset="100%" stop-color="#040A14" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bg)" />
  `;
}

/** Bottom brand strip present on every generated graphic. */
export function svgFooter(width: number, height: number, label: string): string {
  const barY = height - 48;
  return `
    <rect x="0" y="${barY}" width="${width}" height="4" fill="${BRAND.accent}" />
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
