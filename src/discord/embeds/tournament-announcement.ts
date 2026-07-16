import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import type { Tournament, TournamentEntry, GuildConfig } from '../../database/schema/index.js';
import { resolveSchedule, discordTimestamp } from '../../domain/tournaments/schedule.js';
import { calculatePrizePool, formatPence } from '../../domain/payments/prize-pool.js';
import { encodeCustomId } from '../interactions/custom-id.js';
import type { TemplateSchedule } from '../../database/schema/tournament-templates.js';

const NAMESPACE = 'tournament';

export function buildAnnouncementEmbed(
  tournament: Tournament,
  entries: TournamentEntry[],
  guildConfig: GuildConfig,
): EmbedBuilder {
  const schedule = resolveSchedule(tournament.date, tournament.schedule as TemplateSchedule, guildConfig.timezone);

  const paid = entries.filter((e) => e.paymentStatus === 'PAYMENT_CONFIRMED');
  const pending = entries.filter((e) => e.paymentStatus === 'AWAITING_PAYMENT');
  const reserves = entries.filter((e) => e.entryStatus === 'RESERVE');

  const prizePool = calculatePrizePool(tournament.prizeConfiguration, paid.length, tournament.entryFeePence);

  const embed = new EmbedBuilder()
    .setColor(guildConfig.brandingPrimaryColor as `#${string}`)
    .setAuthor({ name: 'MindSet Tournament Bot' })
    .setTitle(`🏆 ${tournament.name} — Cash Cup`)
    .setDescription(
      [
        `**Status:** ${tournament.status.replace(/_/g, ' ')}${tournament.paused ? ' (⏸️ PAUSED)' : ''}`,
        `**Entry fee:** ${formatPence(tournament.entryFeePence)} per team`,
        `**Timezone:** ${guildConfig.timezone}`,
      ].join('\n'),
    )
    .addFields(
      {
        name: 'Schedule',
        value: [
          `Premium priority ends: ${discordTimestamp(schedule.premiumCutoff, 't')}`,
          `Payment deadline: ${discordTimestamp(schedule.paymentDeadline, 't')}`,
          `Signup closes: ${discordTimestamp(schedule.signupClose, 't')}`,
          `Groups published: ${discordTimestamp(schedule.groupPublish, 't')}`,
          `Round 1 / 2 / 3: ${discordTimestamp(schedule.roundOne, 't')} / ${discordTimestamp(schedule.roundTwo, 't')} / ${discordTimestamp(schedule.roundThree, 't')}`,
        ].join('\n'),
        inline: false,
      },
      {
        name: 'Entries',
        value: [
          `✅ Paid: **${paid.length}**`,
          `⏳ Pending payment: **${pending.length}**`,
          `🔁 Reserves: **${reserves.length}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Prize Pool',
        value:
          formatPence(prizePool.netPence) + (prizePool.isManualOverride ? ' *(manually overridden)*' : ' *(projected)*'),
        inline: true,
      },
    );

  if (guildConfig.premiumRoleId) {
    embed.addFields({
      name: 'Premium Priority',
      value: `<@&${guildConfig.premiumRoleId}> members get priority entry until ${discordTimestamp(schedule.premiumCutoff, 't')}. Premium still requires payment.`,
      inline: false,
    });
  }
  if (guildConfig.rulesChannelId) {
    embed.addFields({ name: 'Rules', value: `<#${guildConfig.rulesChannelId}>`, inline: false });
  }

  embed.setFooter({ text: `Last updated` }).setTimestamp(new Date());

  return embed;
}

export function buildAnnouncementComponents(
  tournamentId: string,
): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'signup', tournamentId))
        .setLabel('Sign Up')
        .setEmoji('📝')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'pullout', tournamentId))
        .setLabel('Pull Out')
        .setEmoji('🚪')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'comanager', tournamentId))
        .setLabel('Manage Co-Manager')
        .setEmoji('🤝')
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'view_entry', tournamentId))
        .setLabel('View Entry')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'view_rules', tournamentId))
        .setLabel('View Rules')
        .setEmoji('📜')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'refresh', tournamentId))
        .setLabel('Refresh')
        .setEmoji('🔄')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'admin', tournamentId))
        .setLabel('Admin')
        .setEmoji('🛠️')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}
