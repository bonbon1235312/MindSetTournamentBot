import type { ScheduledJob } from '../../database/schema/index.js';
import type { AppContext } from '../../types/context.js';
import { getGroupById, getGroupMemberships } from '../../database/repositories/group-repository.js';
import { getEntryById, updateEntryStatus } from '../../database/repositories/entry-repository.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import { getTournamentById } from '../../database/repositories/tournament-repository.js';

/** Section 15, +3/+6/+9/+12 minutes: pings whichever teams still haven't
 * confirmed their roster. A no-op once a group's already past this (every
 * team confirmed, or the deadline already fired) — harmless to still have
 * a couple of these queued up if the group finished confirming early. */
export async function handleGroupConfirmationReminder(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const groupId = job.payload.groupId as string | undefined;
  if (!groupId) throw new Error('GROUP_CONFIRMATION_REMINDER job is missing payload.groupId');

  const group = await getGroupById(ctx.db, groupId);
  if (!group) throw new Error(`Group ${groupId} not found`);
  if (!group.chatChannelId) return;

  const memberships = await getGroupMemberships(ctx.db, groupId);
  const mentions: string[] = [];
  for (const membership of memberships) {
    const entry = await getEntryById(ctx.db, membership.tournamentEntryId);
    if (!entry || entry.confirmationStatus !== 'PENDING') continue;
    mentions.push(`<@${entry.managerUserId}>`, ...(entry.coManagerUserId ? [`<@${entry.coManagerUserId}>`] : []));
  }
  if (mentions.length === 0) {
    ctx.logger.info({ groupId }, 'Every team already confirmed — reminder skipped');
    return;
  }

  const tournament = await getTournamentById(ctx.db, group.tournamentId);
  if (!tournament) return;
  const guild = await ctx.client.guilds.fetch(tournament.guildId).catch(() => null);
  const channel = guild ? await guild.channels.fetch(group.chatChannelId).catch(() => null) : null;
  if (!channel?.isTextBased()) return;
  await channel
    .send(`⏰ ${mentions.join(' ')} — please confirm your roster above.`)
    .catch((error: unknown) => ctx.logger.warn({ error, groupId }, 'Could not post the confirmation reminder'));
}

/** Section 15, +15 minutes: still-unconfirmed teams get marked
 * INACTIVE_PENDING_REPLACEMENT and staff are alerted to decide what to do
 * (per team decision: no automatic reserve swap — swapping a team after
 * fixtures already exist is a real data-integrity risk to automate). */
export async function handleGroupConfirmationDeadline(job: ScheduledJob, ctx: AppContext): Promise<void> {
  const groupId = job.payload.groupId as string | undefined;
  if (!groupId) throw new Error('GROUP_CONFIRMATION_DEADLINE job is missing payload.groupId');

  const group = await getGroupById(ctx.db, groupId);
  if (!group) throw new Error(`Group ${groupId} not found`);

  const memberships = await getGroupMemberships(ctx.db, groupId);
  const unconfirmed: string[] = [];
  for (const membership of memberships) {
    const entry = await getEntryById(ctx.db, membership.tournamentEntryId);
    if (!entry || entry.confirmationStatus !== 'PENDING') continue;
    await updateEntryStatus(ctx.db, entry.id, entry.version, { confirmationStatus: 'INACTIVE_PENDING_REPLACEMENT' });
    const club = await getClubById(ctx.db, entry.clubId);
    unconfirmed.push(club?.displayName ?? 'Unknown team');
  }

  if (unconfirmed.length === 0) {
    ctx.logger.info({ groupId }, 'Every team confirmed before the deadline');
    return;
  }

  if (group.staffChannelId) {
    const tournament = await getTournamentById(ctx.db, group.tournamentId);
    const guild = tournament ? await ctx.client.guilds.fetch(tournament.guildId).catch(() => null) : null;
    const channel = guild ? await guild.channels.fetch(group.staffChannelId).catch(() => null) : null;
    if (channel?.isTextBased()) {
      await channel
        .send(`⚠️ **Group ${group.groupCode}**: ${unconfirmed.join(', ')} didn't confirm their roster in time — decide how to proceed.`)
        .catch((error: unknown) => ctx.logger.warn({ error, groupId }, 'Could not post the staff confirmation-deadline alert'));
    }
  }

  ctx.logger.info({ groupId, unconfirmed }, 'Group confirmation deadline passed for one or more teams');
}
