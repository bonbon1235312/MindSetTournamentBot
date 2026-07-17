import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type ChatInputCommandInteraction, type ButtonInteraction, type MessageActionRowComponentBuilder, type SlashCommandSubcommandBuilder } from 'discord.js';
import type { AppContext } from '../../types/context.js';
import { getActiveTournamentForGuild, getTournamentById } from '../../database/repositories/tournament-repository.js';
import { getGroupsByTournament, getGroupMemberships } from '../../database/repositories/group-repository.js';
import { getFixturesByGroup, getFixturesByTournament } from '../../database/repositories/fixture-repository.js';
import { getEntryById } from '../../database/repositories/entry-repository.js';
import { getKnockoutRoundsByTournament } from '../../database/repositories/knockout-round-repository.js';
import { isResolvedFixtureStatus } from '../../domain/fixtures/state-machine.js';
import { STAGE_LABELS } from '../../domain/knockouts/knockout-draw.js';
import { forceCheckTournamentProgression } from '../../services/knockout-trigger-service.js';
import { cancelAndFinalizeTournament } from '../../services/tournament-progression-service.js';
import { encodeCustomId, decodeCustomId } from '../interactions/custom-id.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { isStaffMember } from '../permissions/staff.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import { PermissionError, StalePanelError, ValidationError } from '../../types/errors.js';

const NAMESPACE = 'tournament_repair';

export function addTournamentRepairSubcommand(sub: SlashCommandSubcommandBuilder): SlashCommandSubcommandBuilder {
  return sub.setName('repair').setDescription('Diagnostic report on the current tournament — force-advance or cancel it (staff only)');
}

async function buildRepairReport(ctx: AppContext, tournamentId: string): Promise<{ embed: EmbedBuilder; components: ActionRowBuilder<MessageActionRowComponentBuilder>[] }> {
  const tournament = await getTournamentById(ctx.db, tournamentId);
  if (!tournament) throw new Error(`Tournament ${tournamentId} not found`);

  const groups = await getGroupsByTournament(ctx.db, tournamentId);
  const groupLines: string[] = [];
  let overdueCount = 0;

  for (const group of groups) {
    const fixtures = await getFixturesByGroup(ctx.db, group.id);
    const resolved = fixtures.filter((f) => isResolvedFixtureStatus(f.status)).length;
    overdueCount += fixtures.filter((f) => f.status === 'OVERDUE').length;

    const memberships = await getGroupMemberships(ctx.db, group.id);
    let confirmed = 0;
    for (const m of memberships) {
      const entry = await getEntryById(ctx.db, m.tournamentEntryId);
      if (entry && (entry.confirmationStatus === 'CONFIRMED' || entry.confirmationStatus === 'FORCE_CONFIRMED')) confirmed++;
    }
    groupLines.push(`**Group ${group.groupCode}** — ${resolved}/${fixtures.length} fixtures resolved, ${confirmed}/${memberships.length} rosters confirmed`);
  }

  const rounds = await getKnockoutRoundsByTournament(ctx.db, tournamentId);
  const roundLines: string[] = [];
  const allFixtures = await getFixturesByTournament(ctx.db, tournamentId);
  for (const round of rounds) {
    const roundFixtures = allFixtures.filter((f) => f.knockoutRoundId === round.id);
    const resolved = roundFixtures.filter((f) => isResolvedFixtureStatus(f.status)).length;
    overdueCount += roundFixtures.filter((f) => f.status === 'OVERDUE').length;
    roundLines.push(`**${STAGE_LABELS[round.stage]}** — ${round.status}, ${resolved}/${roundFixtures.length} fixtures resolved`);
  }

  const embed = new EmbedBuilder()
    .setColor(overdueCount > 0 ? '#C0392B' : '#141414')
    .setAuthor({ name: 'MindSet Tournament Bot  ·  Repair Report' })
    .setTitle(tournament.name)
    .addFields(
      { name: 'Status', value: tournament.status, inline: true },
      { name: 'Overdue fixtures', value: String(overdueCount), inline: true },
      { name: 'Groups', value: groupLines.length > 0 ? groupLines.join('\n') : 'None yet', inline: false },
      ...(roundLines.length > 0 ? [{ name: 'Knockout', value: roundLines.join('\n'), inline: false }] : []),
    )
    .setFooter({ text: 'Force Check Progression re-runs the same "is this fully resolved" check the bot already runs automatically after every result.' })
    .setTimestamp(new Date());

  const components = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'force_check', tournamentId)).setLabel('Force Check Progression').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'cancel', tournamentId)).setLabel('Cancel Tournament').setStyle(ButtonStyle.Danger),
    ),
  ];

  return { embed, components };
}

export async function executeTournamentRepair(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!interaction.inGuild() || !interaction.guildId) return;

  const tournament = await getActiveTournamentForGuild(ctx.db, interaction.guildId);
  if (!tournament) {
    await interaction.reply({ content: 'No active tournament to repair — nothing is currently in progress for this server.', ephemeral: true });
    return;
  }

  const { embed, components } = await buildRepairReport(ctx, tournament.id);
  await interaction.reply({ embeds: [embed], components, ephemeral: true });
}

export async function handleRepairComponent(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;
  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) throw new PermissionError('Staff management only.');

  const { action, parts } = decodeCustomId(interaction.customId);
  const tournamentId = parts[0]!;

  if (action === 'force_check') {
    await forceCheckTournamentProgression(ctx, tournamentId);
    const { embed, components } = await buildRepairReport(ctx, tournamentId);
    await interaction.update({ embeds: [embed], components });
    return;
  }

  if (action === 'cancel') {
    const tournament = await getTournamentById(ctx.db, tournamentId);
    if (!tournament) throw new ValidationError('That tournament no longer exists.');
    await interaction.reply({
      content:
        `Cancel **${tournament.name}** (currently \`${tournament.status}\`)? This ends the tournament — ` +
        'it stops blocking a new one from being created, but no Discord channels/roles are deleted and no ' +
        'entry statuses change. Handle any in-progress payments/prizes separately first.',
      components: [
        new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
          new ButtonBuilder().setCustomId(encodeCustomId(NAMESPACE, 'cancel_confirm', tournamentId)).setLabel('Yes, cancel it').setStyle(ButtonStyle.Danger),
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (action === 'cancel_confirm') {
    const tournament = await getTournamentById(ctx.db, tournamentId);
    if (!tournament) throw new ValidationError('That tournament no longer exists.');

    let cancelled;
    try {
      cancelled = await cancelAndFinalizeTournament(ctx.db, tournament);
    } catch (error) {
      if (error instanceof StalePanelError) {
        await interaction.update({ content: '⚠️ This tournament changed since this report was posted — re-run `/tournament repair` and try again.', components: [] });
        return;
      }
      throw error;
    }

    await recordAuditEvent(ctx.db, ctx.logger, {
      guildId: interaction.guildId!,
      tournamentId: tournament.id,
      actorType: 'ADMIN',
      actorDiscordId: interaction.user.id,
      action: 'tournament.cancel',
      targetEntityType: 'tournament',
      targetEntityId: tournament.id,
      beforeState: { status: tournament.status },
      afterState: { status: cancelled.status },
      correlationId: newCorrelationId(),
      interactionId: interaction.id,
    });

    await interaction.update({ content: `✅ **${tournament.name}** cancelled and finalized to \`${cancelled.status}\`. A new tournament can now be created.`, components: [] });
  }
}
