import { GRAPHIC_DIMENSIONS } from '../../config/constants.js';
import { BRAND, FONT_STACK, svgBackground, svgDocument, svgFooter, svgLogo } from '../svg/base.js';
import { truncateAndEscape, escapeXml } from '../svg/escape.js';

export interface GroupFixtureMatch {
  home: string;
  away: string;
}

export interface GroupFixtureRound {
  roundLabel: string; // "ROUND ONE"
  timeLabel: string; // "9:15 PM"
  matches: GroupFixtureMatch[]; // exactly 2 for a 4-team group
}

export interface GroupFixturesGraphicInput {
  tournamentName: string;
  groupCode: string; // "A"
  rounds: GroupFixtureRound[]; // exactly 3 for a 4-team group
}

const TEAM_NAME_MAX_CHARS = 16;
const { width: W, height: H } = GRAPHIC_DIMENSIONS;

/**
 * Section 14's group fixture graphic: square, "GROUP A" title, three round
 * sections with two fixtures each, team names on opposite sides, match time
 * centred. Pure function — takes typed data, returns an SVG string; the
 * caller (renderers/group-fixtures-renderer.ts) rasterises it via Sharp.
 */
export function renderGroupFixturesSvg(input: GroupFixturesGraphicInput): string {
  const headerHeight = 250;
  const footerHeight = 70;
  const roundsAreaTop = headerHeight + 20;
  const roundsAreaHeight = H - headerHeight - footerHeight - 30;
  const roundHeight = roundsAreaHeight / input.rounds.length;

  const header = `
    ${svgLogo(W / 2, 66, 72)}
    <text x="${W / 2}" y="130" text-anchor="middle" font-family="${FONT_STACK}"
      font-size="24" font-weight="600" letter-spacing="4" fill="${BRAND.muted}">
      ${truncateAndEscape(input.tournamentName.toUpperCase(), 40)}
    </text>
    <text x="${W / 2}" y="205" text-anchor="middle" font-family="${FONT_STACK}"
      font-size="88" font-weight="800" fill="${BRAND.text}">
      GROUP ${escapeXml(input.groupCode)}
    </text>
    <line x1="90" y1="${headerHeight - 10}" x2="${W - 90}" y2="${headerHeight - 10}" stroke="${BRAND.accent}" stroke-width="2" opacity="0.4" />
  `;

  const roundsSvg = input.rounds
    .map((round, roundIndex) => renderRound(round, roundsAreaTop + roundIndex * roundHeight, roundHeight))
    .join('');

  const body = `${svgBackground(W, H)}${header}${roundsSvg}${svgFooter(W, H, 'CASH CUP')}`;
  return svgDocument(W, H, body);
}

function renderRound(round: GroupFixtureRound, top: number, height: number): string {
  const labelY = top + 34;
  const matchAreaTop = top + 50;
  const matchHeight = (height - 60) / round.matches.length;

  const label = `
    <text x="90" y="${labelY}" font-family="${FONT_STACK}" font-size="24" font-weight="700"
      letter-spacing="2" fill="${BRAND.accent}">${escapeXml(round.roundLabel.toUpperCase())}</text>
    <text x="${W - 90}" y="${labelY}" text-anchor="end" font-family="${FONT_STACK}" font-size="24"
      font-weight="700" fill="${BRAND.text}" opacity="0.85">${escapeXml(round.timeLabel)}</text>
  `;

  const matches = round.matches
    .map((match, i) => renderMatch(match, matchAreaTop + i * matchHeight, matchHeight))
    .join('');

  return `${label}${matches}`;
}

function renderMatch(match: GroupFixtureMatch, top: number, height: number): string {
  const centerY = top + height / 2;
  const cardTop = top + 6;
  const cardHeight = height - 16;

  const homeName = truncateAndEscape(match.home, TEAM_NAME_MAX_CHARS);
  const awayName = truncateAndEscape(match.away, TEAM_NAME_MAX_CHARS);

  return `
    <rect x="90" y="${cardTop}" width="${W - 180}" height="${cardHeight}" rx="14"
      fill="${BRAND.cardFill}" stroke="${BRAND.cardStroke}" stroke-width="1.5" />
    <text x="130" y="${centerY + 8}" font-family="${FONT_STACK}" font-size="30" font-weight="700"
      fill="${BRAND.text}">${homeName}</text>
    <text x="${W / 2}" y="${centerY + 8}" text-anchor="middle" font-family="${FONT_STACK}" font-size="24"
      font-weight="700" fill="${BRAND.accent}" opacity="0.9">VS</text>
    <text x="${W - 130}" y="${centerY + 8}" text-anchor="end" font-family="${FONT_STACK}" font-size="30"
      font-weight="700" fill="${BRAND.text}">${awayName}</text>
  `;
}
