import { KNOCKOUT_GRAPHIC_DIMENSIONS } from '../../config/constants.js';
import { BRAND, FONT_STACK, svgBackground, svgDocument, svgFooter, svgLogo } from '../svg/base.js';
import { truncateAndEscape, escapeXml } from '../svg/escape.js';

export interface KnockoutBracketMatchup {
  home: string;
  away: string;
}

export interface KnockoutBracketGraphicInput {
  tournamentName: string;
  stageLabel: string; // "QUARTER FINALS"
  matchups: KnockoutBracketMatchup[];
}

const TEAM_NAME_MAX_CHARS = 20;
const { width: W, height: H } = KNOCKOUT_GRAPHIC_DIMENSIONS;

/**
 * The knockout draw graphic: widescreen (matches KNOCKOUT_GRAPHIC_DIMENSIONS,
 * distinct from the square group graphics), logo + stage title header, then
 * every matchup for the round being published. Switches to two columns once
 * there are enough matchups that a single column would run off the bottom.
 */
export function renderKnockoutBracketSvg(input: KnockoutBracketGraphicInput): string {
  const headerHeight = 220;
  const footerHeight = 70;
  const areaTop = headerHeight + 20;
  const areaHeight = H - headerHeight - footerHeight - 30;

  const header = `
    ${svgLogo(W / 2, 66, 72)}
    <text x="${W / 2}" y="130" text-anchor="middle" font-family="${FONT_STACK}"
      font-size="24" font-weight="600" letter-spacing="4" fill="${BRAND.muted}">
      ${truncateAndEscape(input.tournamentName.toUpperCase(), 50)}
    </text>
    <text x="${W / 2}" y="200" text-anchor="middle" font-family="${FONT_STACK}"
      font-size="66" font-weight="800" fill="${BRAND.text}">
      ${escapeXml(input.stageLabel.toUpperCase())}
    </text>
  `;

  const useTwoColumns = input.matchups.length > 4;
  const columns = useTwoColumns ? 2 : 1;
  const rows = Math.ceil(input.matchups.length / columns);
  const colWidth = (W - 180 - (useTwoColumns ? 40 : 0)) / columns;
  const rowGap = 20;
  const rowHeight = Math.min(130, (areaHeight - rowGap * (rows - 1)) / rows);

  const matchupsSvg = input.matchups
    .map((m, i) => {
      const col = Math.floor(i / rows);
      const row = i % rows;
      const x = 90 + col * (colWidth + (useTwoColumns ? 40 : 0));
      const y = areaTop + row * (rowHeight + rowGap);
      return renderMatchup(m, x, y, colWidth, rowHeight);
    })
    .join('');

  const body = `${svgBackground(W, H)}${header}${matchupsSvg}${svgFooter(W, H, 'KNOCKOUT DRAW')}`;
  return svgDocument(W, H, body);
}

function renderMatchup(m: KnockoutBracketMatchup, x: number, y: number, width: number, height: number): string {
  const centerY = y + height / 2 + 8;
  const homeName = truncateAndEscape(m.home, TEAM_NAME_MAX_CHARS);
  const awayName = truncateAndEscape(m.away, TEAM_NAME_MAX_CHARS);

  return `
    <rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14"
      fill="${BRAND.cardFill}" stroke="${BRAND.cardStroke}" stroke-width="1.5" />
    <text x="${x + 30}" y="${centerY}" font-family="${FONT_STACK}" font-size="28" font-weight="700" fill="${BRAND.text}">${homeName}</text>
    <text x="${x + width / 2}" y="${centerY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="22"
      font-weight="700" fill="${BRAND.accent}" opacity="0.9">VS</text>
    <text x="${x + width - 30}" y="${centerY}" text-anchor="end" font-family="${FONT_STACK}" font-size="28" font-weight="700" fill="${BRAND.text}">${awayName}</text>
  `;
}
