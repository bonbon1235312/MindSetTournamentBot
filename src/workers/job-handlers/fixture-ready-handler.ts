import { DateTime } from 'luxon';
import type { ScheduledJob } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getFixtureById, updateFixtureStatus } from '../../database/repositories/fixture-repository.js';
import { assertFixtureTransition } from '../../domain/fixtures/state-machine.js';
import { RESULT_FIRST_REMINDER_MINUTES, RESULT_STAFF_ALERT_MINUTES } from '../../config/constants.js';

/** Section 19: a fixture becomes submittable at its scheduled kickoff time,
 * not the moment it's created — walks SCHEDULED -> READY ->
 * WAITING_FOR_SUBMISSIONS (two legal hops) so managers can't report a
 * result for a match that hasn't been played yet. Also enqueues the
 * RESULT_FIRST_REMINDER (+30min) and RESULT_STAFF_ALERT (+35min) jobs
 * anchored to the moment it actually went ready.
 *
 * Resumable, not just idempotent: if a prior run got interrupted between
 * the two hops (a retry after a transient failure, a crash, a race with
 * another caller), a fixture can legitimately be sitting at READY rather
 * than SCHEDULED or WAITING_FOR_SUBMISSIONS. Treating "not SCHEDULED" as
 * "nothing to do" would silently strand it at READY forever — this only
 * short-circuits once it's actually reached RESOLVED/FORFEIT/VOID/etc
 * (anything past the point reminders would still be useful), and resumes
 * from wherever it actually is otherwise. The reminder enqueues are safe
 * to repeat on a retry too — the scheduler's idempotencyKey skips a
 * duplicate rather than double-booking. */
export async function handleFixtureReady(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const fixtureId = job.payload.fixtureId as string | undefined;
  if (!fixtureId) throw new Error('FIXTURE_READY job is missing payload.fixtureId');

  let fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);

  if (fixture.status === 'SCHEDULED' || fixture.status === 'READY') {
    if (fixture.status === 'SCHEDULED') {
      assertFixtureTransition('SCHEDULED', 'READY');
      fixture = await updateFixtureStatus(ctx.db, fixture.id, fixture.version, 'READY', { readyAt: new Date() });
    }
    assertFixtureTransition('READY', 'WAITING_FOR_SUBMISSIONS');
    fixture = await updateFixtureStatus(ctx.db, fixture.id, fixture.version, 'WAITING_FOR_SUBMISSIONS');
    ctx.logger.info({ fixtureId }, 'Fixture is ready — now accepting result submissions');
  } else if (fixture.status !== 'WAITING_FOR_SUBMISSIONS') {
    ctx.logger.info({ fixtureId, status: fixture.status }, 'Fixture already past waiting-for-submissions — nothing to do (idempotent)');
    return;
  }

  const readyAt = DateTime.fromJSDate(fixture.readyAt ?? new Date());
  await ctx.scheduler.enqueue({
    tournamentId: fixture.tournamentId,
    jobType: 'RESULT_FIRST_REMINDER',
    runAt: readyAt.plus({ minutes: RESULT_FIRST_REMINDER_MINUTES }).toJSDate(),
    idempotencyKey: `RESULT_FIRST_REMINDER:${fixture.id}`,
    payload: { fixtureId: fixture.id },
  });
  await ctx.scheduler.enqueue({
    tournamentId: fixture.tournamentId,
    jobType: 'RESULT_STAFF_ALERT',
    runAt: readyAt.plus({ minutes: RESULT_STAFF_ALERT_MINUTES }).toJSDate(),
    idempotencyKey: `RESULT_STAFF_ALERT:${fixture.id}`,
    payload: { fixtureId: fixture.id },
  });
}
