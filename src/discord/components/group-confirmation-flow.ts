import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ButtonInteraction, type MessageActionRowComponentBuilder } from 'discord.js';
import type { AppContext } from '../../types/context.js';
import { getGroupById, getGroupMemberships } from '../../database/repositories/group-repository.js';
import { getEntryById, updateEntryStatus } from '../../database/repositories/entry-repository.js';
import { getClubById } from '../../database/repositories/club-repository.js';
import { encodeCustomId } from '../interactions/custom-id.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import { NotFoundError } from '../../types/errors.js';

const NAMESPACE = 'group';

/** Posted once per group, right after publish — a single shared panel any
 * of the group's managers/co-managers can click to confirm their own
 * team's roster (their identity, not a picked option, decides which entry
 * gets marked). No live "X/4 confirmed" counter is maintained on this
 * message — the reminder/deadline jobs are the actual mechanism that
 * matters, this is just the entry point. */
export function buildRosterConfirmationEmbed(groupCode: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor('#141414')
    .setAuthor({ name: 'MindSet Tournament Bot' })
    .setTitle(`Group ${groupCode} — Confirm Your Roster`)
    .setDescription(
      "Manager or co-manager of each team: click below once to confirm you're playing with the roster you signed up with. " +
        'Unconfirmed teams get a reminder, then staff are alerted if nobody confirms in time.',
    );
}

export function buildRosterConfirmationComponents(groupId: string): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'confirm_roster', groupId)).setLabel('Confirm My Roster').setStyle(ButtonStyle.Success),
    ),
  ];
}

export async function handleConfirmRosterButton(interaction: ButtonInteraction, ctx: AppContext, groupId: string): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const group = await getGroupById(ctx.db, groupId);
  if (!group) throw new NotFoundError('Group');

  const memberships = await getGroupMemberships(ctx.db, groupId);
  for (const membership of memberships) {
    const entry = await getEntryById(ctx.db, membership.tournamentEntryId);
    if (!entry) continue;
    if (entry.managerUserId !== interaction.user.id && entry.coManagerUserId !== interaction.user.id) continue;

    if (entry.confirmationStatus === 'CONFIRMED' || entry.confirmationStatus === 'FORCE_CONFIRMED') {
      await interaction.reply({ content: "✅ Your team's roster is already confirmed.", ephemeral: true });
      return;
    }

    await updateEntryStatus(ctx.db, entry.id, entry.version, { confirmationStatus: 'CONFIRMED' });
    const club = await getClubById(ctx.db, entry.clubId);

    await recordAuditEvent(ctx.db, ctx.logger, {
      guildId: interaction.guildId!,
      tournamentId: entry.tournamentId,
      actorType: 'USER',
      actorDiscordId: interaction.user.id,
      action: 'entry.confirm_roster',
      targetEntityType: 'tournament_entry',
      targetEntityId: entry.id,
      correlationId: newCorrelationId(),
      interactionId: interaction.id,
    });

    await interaction.reply({ content: `✅ Roster confirmed for **${club?.displayName ?? 'your team'}**.`, ephemeral: true });
    return;
  }

  await interaction.reply({ content: "You're not the manager or co-manager of a team in this group.", ephemeral: true });
}
