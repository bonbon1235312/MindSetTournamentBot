import { POINTS_DRAW, POINTS_LOSS, POINTS_WIN } from '../../config/constants.js';

export interface StandingsEntryInput {
  entryId: string;
  teamName: string;
}

export interface FixtureResultInput {
  homeEntryId: string;
  awayEntryId: string;
  homeScore: number;
  awayScore: number;
}

export interface TeamStanding {
  entryId: string;
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

function emptyStanding(entry: StandingsEntryInput): TeamStanding {
  return {
    entryId: entry.entryId,
    teamName: entry.teamName,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  };
}

/**
 * Pure, deterministic standings calculation (section 20). Only RESOLVED
 * fixture results should be passed in — this function has no opinion on
 * fixture status, callers filter beforehand.
 */
export function calculateStandings(
  entries: readonly StandingsEntryInput[],
  results: readonly FixtureResultInput[],
): TeamStanding[] {
  const table = new Map<string, TeamStanding>();
  for (const entry of entries) {
    table.set(entry.entryId, emptyStanding(entry));
  }

  for (const result of results) {
    const home = table.get(result.homeEntryId);
    const away = table.get(result.awayEntryId);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.goalsFor += result.homeScore;
    home.goalsAgainst += result.awayScore;
    away.goalsFor += result.awayScore;
    away.goalsAgainst += result.homeScore;

    if (result.homeScore > result.awayScore) {
      home.wins += 1;
      home.points += POINTS_WIN;
      away.losses += 1;
      away.points += POINTS_LOSS;
    } else if (result.homeScore < result.awayScore) {
      away.wins += 1;
      away.points += POINTS_WIN;
      home.losses += 1;
      home.points += POINTS_LOSS;
    } else {
      home.draws += 1;
      away.draws += 1;
      home.points += POINTS_DRAW;
      away.points += POINTS_DRAW;
    }
  }

  for (const standing of table.values()) {
    standing.goalDifference = standing.goalsFor - standing.goalsAgainst;
  }

  return sortStandings([...table.values()]);
}

/**
 * Section 20's EXACT tiebreaker order: points, then goal difference, then
 * alphabetical team name (case-insensitive, deterministic). Deliberately
 * does NOT use goals scored, head-to-head, wins, or disciplinary points.
 */
export function sortStandings(standings: readonly TeamStanding[]): TeamStanding[] {
  return [...standings].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    return a.teamName.toLowerCase().localeCompare(b.teamName.toLowerCase());
  });
}
