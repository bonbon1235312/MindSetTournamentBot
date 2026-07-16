import type { ScheduledJob } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getFixtureById, updateFixtureStatus } from '../../database/repositories/fixture-repository.js';
import { assertFixtureTransition } from '../../domain/fixtures/state-machine.js';

/** Section 19: a fixture becomes submittable at its scheduled kickoff time,
 * not the moment it's created — walks SCHEDULED -> READY ->
 * WAITING_FOR_SUBMISSIONS (two legal hops) so managers can't report a
 * result for a match that hasn't been played yet.
 *
 * Resumable, not just idempotent: if a prior run got interrupted between
 * the two hops (a retry after a transient failure, a crash, a race with
 * another caller), a fixture can legitimately be sitting at READY rather
 * than SCHEDULED or WAITING_FOR_SUBMISSIONS. Treating "not SCHEDULED" as
 * "nothing to do" would silently strand it at READY forever — this only
 * short-circuits once it's actually reached WAITING_FOR_SUBMISSIONS or
 * later, and resumes from wherever it actually is. */
export async function handleFixtureReady(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const fixtureId = job.payload.fixtureId as string | undefined;
  if (!fixtureId) throw new Error('FIXTURE_READY job is missing payload.fixtureId');

  let fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);

  if (fixture.status !== 'SCHEDULED' && fixture.status !== 'READY') {
    ctx.logger.info({ fixtureId, status: fixture.status }, 'Fixture already past READY — nothing to do (idempotent)');
    return;
  }

  if (fixture.status === 'SCHEDULED') {
    assertFixtureTransition('SCHEDULED', 'READY');
    fixture = await updateFixtureStatus(ctx.db, fixture.id, fixture.version, 'READY', { readyAt: new Date() });
  }

  assertFixtureTransition('READY', 'WAITING_FOR_SUBMISSIONS');
  await updateFixtureStatus(ctx.db, fixture.id, fixture.version, 'WAITING_FOR_SUBMISSIONS');

  ctx.logger.info({ fixtureId }, 'Fixture is ready — now accepting result submissions');
}
