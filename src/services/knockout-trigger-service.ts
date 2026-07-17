import type { Fixture } from '../database/schema/index.js';
import type { AppContext } from '../types/context.js';
import { getFixturesByGroup, getFixturesByKnockoutRound } from '../database/repositories/fixture-repository.js';
import { getGroupById, getGroupsByTournament } from '../database/repositories/group-repository.js';
import { getKnockoutRoundById, getLatestKnockoutRound } from '../database/repositories/knockout-round-repository.js';
import { getTournamentById } from '../database/repositories/tournament-repository.js';
import { isResolvedFixtureStatus } from '../domain/fixtures/state-machine.js';
import { runInitialKnockoutDraw, advanceKnockoutRound } from '../workers/job-handlers/knockout-publish-handler.js';
import { StalePanelError } from '../types/errors.js';

/**
 * Call this after resolving ANY fixture (dual-submission auto-resolve,
 * staff override, staff conflict resolution) — it's the one place that
 * decides whether that resolution was the tournament's last domino: the
 * final fixture in a group (once every OTHER group is also fully done)
 * triggers the knockout draw; the final fixture in a knockout round
 * triggers the next round (or the champion). Every other resolve is a
 * silent no-op. This is what makes result submission actually finish a
 * real tournament without staff manually running anything.
 *
 * Idempotent by construction: `runInitialKnockoutDraw`/`advanceKnockoutRound`
 * both walk the tournament's status forward via `advanceTournamentTo`,
 * which is a no-op if it's already past the target — and if two fixture
 * resolutions in the same group/round race each other into this function
 * concurrently, the loser's optimistic-lock write fails with
 * StalePanelError, which is caught and swallowed here as "someone else
 * already triggered it."
 */
export async function checkAndAdvancePipeline(ctx: AppContext, fixture: Fixture): Promise<void> {
  try {
    if (fixture.groupId) {
      await maybeAdvanceFromGroup(ctx, fixture.groupId);
    } else if (fixture.knockoutRoundId) {
      await maybeAdvanceFromKnockoutRound(ctx, fixture.knockoutRoundId);
    }
  } catch (error) {
    if (error instanceof StalePanelError) {
      ctx.logger.info({ fixtureId: fixture.id }, 'Pipeline advance lost a race to another trigger — already handled');
      return;
    }
    throw error;
  }
}

async function maybeAdvanceFromGroup(ctx: AppContext, groupId: string): Promise<void> {
  const groupFixtures = await getFixturesByGroup(ctx.db, groupId);
  if (!groupFixtures.every((f) => isResolvedFixtureStatus(f.status))) return;

  const group = await getGroupById(ctx.db, groupId);
  if (!group) return;

  const allGroups = await getGroupsByTournament(ctx.db, group.tournamentId);
  for (const otherGroup of allGroups) {
    const otherFixtures = await getFixturesByGroup(ctx.db, otherGroup.id);
    if (!otherFixtures.every((f) => isResolvedFixtureStatus(f.status))) return; // some other group still has unplayed fixtures
  }

  const tournament = await getTournamentById(ctx.db, group.tournamentId);
  if (!tournament) return;
  if (tournament.status !== 'GROUP_CONFIRMATION' && tournament.status !== 'GROUP_STAGE_LIVE') return; // already advanced

  ctx.logger.info({ tournamentId: tournament.id }, 'Every group fully resolved — triggering knockout draw');
  await runInitialKnockoutDraw(ctx, tournament, {});
}

async function maybeAdvanceFromKnockoutRound(ctx: AppContext, knockoutRoundId: string): Promise<void> {
  const roundFixtures = await getFixturesByKnockoutRound(ctx.db, knockoutRoundId);
  if (!roundFixtures.every((f) => isResolvedFixtureStatus(f.status))) return;

  const round = await getKnockoutRoundById(ctx.db, knockoutRoundId);
  if (!round || round.status === 'COMPLETED') return; // already advanced

  const tournament = await getTournamentById(ctx.db, round.tournamentId);
  if (!tournament || tournament.status === 'COMPLETED') return;

  ctx.logger.info({ tournamentId: tournament.id, stage: round.stage }, 'Knockout round fully resolved — advancing');
  await advanceKnockoutRound(ctx, tournament, {});
}

/** Staff safety-net for `/tournament repair`: re-runs the exact same
 * "is everything actually resolved" checks the automatic trigger runs,
 * in case an interaction ever failed silently and the automatic path
 * never fired. Every group and the current knockout round (if any) get
 * checked; anything not actually ready is a no-op, same as always. */
export async function forceCheckTournamentProgression(ctx: AppContext, tournamentId: string): Promise<void> {
  const groups = await getGroupsByTournament(ctx.db, tournamentId);
  for (const group of groups) {
    try {
      await maybeAdvanceFromGroup(ctx, group.id);
    } catch (error) {
      if (!(error instanceof StalePanelError)) throw error;
    }
  }

  const latestRound = await getLatestKnockoutRound(ctx.db, tournamentId);
  if (latestRound) {
    try {
      await maybeAdvanceFromKnockoutRound(ctx, latestRound.id);
    } catch (error) {
      if (!(error instanceof StalePanelError)) throw error;
    }
  }
}
