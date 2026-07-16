import { GRAPHIC_DIMENSIONS } from '../../config/constants.js';
import { BRAND, FONT_STACK, svgBackground, svgDocument, svgFooter, svgLogo } from '../svg/base.js';
import { truncateAndEscape } from '../svg/escape.js';
import { escapeXml } from '../svg/escape.js';

export interface GroupStandingsRow {
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  points: number;
}

export interface GroupStandingsGraphicInput {
  tournamentName: string;
  groupCode: string;
  /** Already sorted (standings.sortStandings) — row 0 is 1st place. */
  standings: GroupStandingsRow[];
  /** How many top rows qualify — drawn with a highlighted background and a
   * divider line beneath the last qualifying row (section 20: "Show
   * qualification lines clearly"). */
  qualifyingPositions: number;
}

const { width: W, height: H } = GRAPHIC_DIMENSIONS;

const COLUMNS = [
  { key: 'pos', label: '#', x: 130, anchor: 'start' as const },
  { key: 'team', label: 'TEAM', x: 175, anchor: 'start' as const },
  { key: 'p', label: 'P', x: 620, anchor: 'middle' as const },
  { key: 'w', label: 'W', x: 680, anchor: 'middle' as const },
  { key: 'd', label: 'D', x: 740, anchor: 'middle' as const },
  { key: 'l', label: 'L', x: 800, anchor: 'middle' as const },
  { key: 'gd', label: 'GD', x: 880, anchor: 'middle' as const },
  { key: 'pts', label: 'PTS', x: 970, anchor: 'middle' as const },
];

export function renderGroupStandingsSvg(input: GroupStandingsGraphicInput): string {
  const headerHeight = 250;
  const footerHeight = 70;
  const tableTop = headerHeight + 30;
  const rowHeight = (H - headerHeight - footerHeight - 90) / Math.max(input.standings.length, 1);

  const header = `
    ${svgLogo(W / 2, 66, 72)}
    <text x="${W / 2}" y="130" text-anchor="middle" font-family="${FONT_STACK}"
      font-size="24" font-weight="600" letter-spacing="4" fill="${BRAND.muted}">
      ${truncateAndEscape(input.tournamentName.toUpperCase(), 40)}
    </text>
    <text x="${W / 2}" y="200" text-anchor="middle" font-family="${FONT_STACK}"
      font-size="70" font-weight="800" fill="${BRAND.text}">
      GROUP ${escapeXml(input.groupCode)} · STANDINGS
    </text>
  `;

  const columnHeadings = COLUMNS.map(
    (col) =>
      `<text x="${col.x}" y="${tableTop + 30}" text-anchor="${col.anchor}" font-family="${FONT_STACK}" font-size="20"
        font-weight="700" letter-spacing="1" fill="${BRAND.accent}" opacity="0.85">${col.label}</text>`,
  ).join('');

  const rows = input.standings
    .map((row, i) => renderStandingsRow(row, i, tableTop + 55 + i * rowHeight, rowHeight, i < input.qualifyingPositions))
    .join('');

  const qualifyLineY = input.qualifyingPositions > 0 ? tableTop + 55 + input.qualifyingPositions * rowHeight - 6 : null;
  const qualifyLine =
    qualifyLineY !== null
      ? `<line x1="90" y1="${qualifyLineY}" x2="${W - 90}" y2="${qualifyLineY}" stroke="${BRAND.accent}" stroke-width="2" stroke-dasharray="6 6" />`
      : '';

  const body = `${svgBackground(W, H)}${header}${columnHeadings}${rows}${qualifyLine}${svgFooter(W, H, 'STANDINGS')}`;
  return svgDocument(W, H, body);
}

function renderStandingsRow(row: GroupStandingsRow, index: number, top: number, height: number, qualifies: boolean): string {
  const centerY = top + height / 2 + 8;
  const rowFill = qualifies ? BRAND.cardFillHighlight : BRAND.cardFill;
  const teamName = truncateAndEscape(row.teamName, 22);
  const gdText = row.goalDifference > 0 ? `+${row.goalDifference}` : String(row.goalDifference);

  return `
    <rect x="90" y="${top}" width="${W - 180}" height="${height - 10}" rx="10"
      fill="${rowFill}" stroke="${BRAND.cardStroke}" stroke-opacity="${qualifies ? 0.9 : 0.4}" stroke-width="1.5" />
    <text x="130" y="${centerY}" font-family="${FONT_STACK}" font-size="26" font-weight="800" fill="${BRAND.accent}">${index + 1}</text>
    <text x="175" y="${centerY}" font-family="${FONT_STACK}" font-size="26" font-weight="700" fill="${BRAND.text}">${teamName}</text>
    <text x="620" y="${centerY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="24" fill="${BRAND.text}" opacity="0.9">${row.played}</text>
    <text x="680" y="${centerY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="24" fill="${BRAND.text}" opacity="0.9">${row.wins}</text>
    <text x="740" y="${centerY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="24" fill="${BRAND.text}" opacity="0.9">${row.draws}</text>
    <text x="800" y="${centerY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="24" fill="${BRAND.text}" opacity="0.9">${row.losses}</text>
    <text x="880" y="${centerY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="24" fill="${BRAND.text}" opacity="0.9">${gdText}</text>
    <text x="970" y="${centerY}" text-anchor="middle" font-family="${FONT_STACK}" font-size="28" font-weight="800" fill="${BRAND.accent}">${row.points}</text>
  `;
}
