import type { ScheduledJob } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getFixtureById, updateFixtureStatus } from '../../database/repositories/fixture-repository.js';
import { assertFixtureTransition } from '../../domain/fixtures/state-machine.js';

/** Section 19: a fixture becomes submittable at its scheduled kickoff time,
 * not the moment it's created — walks SCHEDULED -> READY ->
 * WAITING_FOR_SUBMISSIONS (two legal hops) so managers can't report a
 * result for a match that hasn't been played yet. */
export async function handleFixtureReady(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const fixtureId = job.payload.fixtureId as string | undefined;
  if (!fixtureId) throw new Error('FIXTURE_READY job is missing payload.fixtureId');

  const fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);

  if (fixture.status !== 'SCHEDULED') {
    ctx.logger.info({ fixtureId, status: fixture.status }, 'Fixture already past SCHEDULED — nothing to do (idempotent)');
    return;
  }

  assertFixtureTransition('SCHEDULED', 'READY');
  const ready = await updateFixtureStatus(ctx.db, fixture.id, fixture.version, 'READY', { readyAt: new Date() });

  assertFixtureTransition('READY', 'WAITING_FOR_SUBMISSIONS');
  await updateFixtureStatus(ctx.db, ready.id, ready.version, 'WAITING_FOR_SUBMISSIONS');

  ctx.logger.info({ fixtureId }, 'Fixture is ready — now accepting result submissions');
}
