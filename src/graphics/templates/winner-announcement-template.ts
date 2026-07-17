import { GRAPHIC_DIMENSIONS } from '../../config/constants.js';
import { BRAND, FONT_STACK, svgBackground, svgDocument, svgFooter, svgLogo } from '../svg/base.js';
import { truncateAndEscape } from '../svg/escape.js';

export interface WinnerAnnouncementGraphicInput {
  tournamentName: string;
  championTeamName: string;
}

const { width: W, height: H } = GRAPHIC_DIMENSIONS;

/** The final graphic of a cup's lifecycle — logo, tournament name, and the
 * champion's name large and centered. Deliberately the simplest template
 * in the family: one fact, stated clearly. */
export function renderWinnerAnnouncementSvg(input: WinnerAnnouncementGraphicInput): string {
  const centerY = H * 0.44;

  const body = `
    ${svgLogo(W / 2, centerY - 150, 110)}
    <text x="${W / 2}" y="${centerY - 20}" text-anchor="middle" font-family="${FONT_STACK}"
      font-size="26" font-weight="600" letter-spacing="6" fill="${BRAND.muted}">
      ${truncateAndEscape(input.tournamentName.toUpperCase(), 40)}
    </text>
    <text x="${W / 2}" y="${centerY + 50}" text-anchor="middle" font-family="${FONT_STACK}"
      font-size="30" font-weight="700" letter-spacing="8" fill="${BRAND.accent}">
      CHAMPIONS
    </text>
    <text x="${W / 2}" y="${centerY + 160}" text-anchor="middle" font-family="${FONT_STACK}"
      font-size="78" font-weight="800" fill="${BRAND.text}">
      ${truncateAndEscape(input.championTeamName, 22)}
    </text>
    <line x1="${W / 2 - 160}" y1="${centerY + 210}" x2="${W / 2 + 160}" y2="${centerY + 210}" stroke="${BRAND.accent}" stroke-width="2" opacity="0.5" />
  `;

  return svgDocument(W, H, `${svgBackground(W, H)}${body}${svgFooter(W, H, 'CHAMPIONS')}`);
}
