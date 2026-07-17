import type { ScheduledJob } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getFixtureById, updateFixtureStatus } from '../../database/repositories/fixture-repository.js';
import { getEntryById } from '../../database/repositories/entry-repository.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import { getFixtureParentContext, getFixtureSubmissions } from '../../services/result-submission-service.js';
import { getTournamentById } from '../../database/repositories/tournament-repository.js';
import { assertFixtureTransition } from '../../domain/fixtures/state-machine.js';

const STILL_WAITING_STATUSES = ['WAITING_FOR_SUBMISSIONS', 'WAITING_FOR_OPPONENT'];

async function teamNames(ctx: AppContext, homeEntryId: string, awayEntryId: string) {
  const [homeEntry, awayEntry] = await Promise.all([getEntryById(ctx.db, homeEntryId), getEntryById(ctx.db, awayEntryId)]);
  const [homeClub, awayClub] = await Promise.all([
    homeEntry ? getClubById(ctx.db, homeEntry.clubId) : undefined,
    awayEntry ? getClubById(ctx.db, awayEntry.clubId) : undefined,
  ]);
  return { home: homeClub?.displayName ?? 'Unknown team', away: awayClub?.displayName ?? 'Unknown team', homeEntry, awayEntry };
}

/** Section 19, +30 minutes: a friendly nudge in the chat channel to
 * whichever side(s) haven't submitted yet. A no-op if the fixture has
 * already moved past waiting for submissions (resolved, in conflict,
 * forfeited, voided, or evidence requested) by the time this fires. */
export async function handleResultFirstReminder(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const fixtureId = job.payload.fixtureId as string | undefined;
  if (!fixtureId) throw new Error('RESULT_FIRST_REMINDER job is missing payload.fixtureId');

  const fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);
  if (!STILL_WAITING_STATUSES.includes(fixture.status)) {
    ctx.logger.info({ fixtureId, status: fixture.status }, 'Fixture no longer waiting on a submission — reminder skipped');
    return;
  }

  const parent = await getFixtureParentContext(ctx.db, fixture);
  if (!parent.chatChannelId) return;

  const submissions = await getFixtureSubmissions(ctx.db, fixture.id);
  const submittedEntryIds = new Set(submissions.map((s) => s.submittingEntryId));
  const { home, away, homeEntry, awayEntry } = await teamNames(ctx, fixture.homeEntryId, fixture.awayEntryId);

  const mentions: string[] = [];
  if (!submittedEntryIds.has(fixture.homeEntryId) && homeEntry) {
    mentions.push(`<@${homeEntry.managerUserId}>`, ...(homeEntry.coManagerUserId ? [`<@${homeEntry.coManagerUserId}>`] : []));
  }
  if (!submittedEntryIds.has(fixture.awayEntryId) && awayEntry) {
    mentions.push(`<@${awayEntry.managerUserId}>`, ...(awayEntry.coManagerUserId ? [`<@${awayEntry.coManagerUserId}>`] : []));
  }
  if (mentions.length === 0) return;

  const tournament = await getTournamentById(ctx.db, fixture.tournamentId);
  if (!tournament) return;
  const guild = await ctx.client.guilds.fetch(tournament.guildId).catch(() => null);
  const channel = guild ? await guild.channels.fetch(parent.chatChannelId).catch(() => null) : null;
  if (!channel?.isTextBased()) return;
  await channel
    .send(`⏰ ${mentions.join(' ')} — don't forget to submit your result for **${home} vs ${away}** in the results channel.`)
    .catch((error: unknown) => ctx.logger.warn({ error, fixtureId }, 'Could not post the result reminder'));
}

/** Section 19, +35 minutes: still nothing? Transitions the fixture to
 * OVERDUE and alerts staff — the same "already past this" idempotency
 * check as the first reminder. */
export async function handleResultStaffAlert(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const fixtureId = job.payload.fixtureId as string | undefined;
  if (!fixtureId) throw new Error('RESULT_STAFF_ALERT job is missing payload.fixtureId');

  const fixture = await getFixtureById(ctx.db, fixtureId);
  if (!fixture) throw new Error(`Fixture ${fixtureId} not found`);
  if (!STILL_WAITING_STATUSES.includes(fixture.status)) {
    ctx.logger.info({ fixtureId, status: fixture.status }, 'Fixture no longer waiting on a submission — staff alert skipped');
    return;
  }

  const parent = await getFixtureParentContext(ctx.db, fixture);
  const { home, away } = await teamNames(ctx, fixture.homeEntryId, fixture.awayEntryId);

  assertFixtureTransition(fixture.status, 'OVERDUE');
  await updateFixtureStatus(ctx.db, fixture.id, fixture.version, 'OVERDUE');

  if (!parent.staffChannelId) return;
  const tournament = await getTournamentById(ctx.db, fixture.tournamentId);
  const guild = tournament ? await ctx.client.guilds.fetch(tournament.guildId).catch(() => null) : null;
  const channel = guild ? await guild.channels.fetch(parent.staffChannelId).catch(() => null) : null;
  if (!channel?.isTextBased()) return;
  await channel
    .send(`🔴 **Overdue:** ${home} vs ${away} (${parent.label}) still has no result 35+ minutes after kickoff.`)
    .catch((error: unknown) => ctx.logger.warn({ error, fixtureId }, 'Could not post the staff overdue alert'));

  ctx.logger.info({ fixtureId }, 'Fixture marked OVERDUE, staff alerted');
}
