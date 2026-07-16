import { ChannelType, SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import type { AppContext } from '../../types/context.js';
import { getOrCreateGuildConfig, checkGuildConfigStatus } from '../../database/repositories/guild-config-repository.js';
import { isStaffMember } from '../permissions/staff.js';
import { createTournament, updateTournamentAnnouncement, updateTournamentStatus } from '../../database/repositories/tournament-repository.js';
import { getEntriesByTournament } from '../../database/repositories/entry-repository.js';
import { assertTournamentTransition } from '../../domain/tournaments/state-machine.js';
import { buildAnnouncementEmbed, buildAnnouncementComponents } from '../embeds/tournament-announcement.js';
import { DEFAULT_ENTRY_FEE_PENCE, DEFAULT_SCHEDULE } from '../../config/constants.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import { resolveSchedule } from '../../domain/tournaments/schedule.js';
import { MissingConfigurationError, PermissionError, ValidationError } from '../../types/errors.js';
import { DateTime } from 'luxon';
import type { PrizeConfiguration } from '../../database/schema/tournaments.js';
import { addTournamentTestSubcommand, executeTournamentTest } from './tournament-test.js';

export const tournamentCommand = new SlashCommandBuilder()
  .setName('tournament')
  .setDescription('Manage MindSet cash-cup tournaments (staff only)')
  .addSubcommand((sub) =>
    sub
      .setName('create')
      .setDescription('Create and publish a new cash-cup tournament')
      .addStringOption((opt) => opt.setName('name').setDescription('Tournament name').setRequired(true))
      .addStringOption((opt) =>
        opt.setName('date').setDescription('Tournament date (YYYY-MM-DD, in the server timezone)').setRequired(true),
      )
      .addChannelOption((opt) =>
        opt
          .setName('channel')
          .setDescription('Channel to post the announcement in (defaults to weekday channel if configured)')
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(false),
      )
      .addIntegerOption((opt) =>
        opt.setName('entry_fee_pence').setDescription('Entry fee in pence (default 1500 = £15.00)').setRequired(false),
      ),
  )
  .addSubcommand((sub) => addTournamentTestSubcommand(sub));

export async function executeTournamentCommand(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) {
    await interaction.reply({ content: 'This command only works in a server.', ephemeral: true });
    return;
  }

  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) {
    throw new PermissionError('Staff management only.');
  }

  const subcommand = interaction.options.getSubcommand();
  if (subcommand === 'test') {
    await executeTournamentTest(interaction, ctx);
    return;
  }
  if (subcommand !== 'create') return;

  const status = checkGuildConfigStatus(config);
  if (!status.configured) {
    throw new MissingConfigurationError(status.missing);
  }

  const name = interaction.options.getString('name', true);
  const dateISO = interaction.options.getString('date', true);
  const explicitChannel = interaction.options.getChannel('channel');
  const entryFeePence = interaction.options.getInteger('entry_fee_pence') ?? DEFAULT_ENTRY_FEE_PENCE;

  if (!DateTime.fromISO(dateISO, { zone: config.timezone }).isValid) {
    throw new ValidationError('Date must be in YYYY-MM-DD format.');
  }

  let channelId = explicitChannel?.id;
  if (!channelId) {
    const weekday = DateTime.fromISO(dateISO, { zone: config.timezone }).toFormat('cccc').toLowerCase();
    channelId = config.tournamentChannels[weekday];
  }
  if (!channelId) {
    throw new ValidationError(
      'No channel specified and no weekday channel configured for that date. Pass a channel or run /setup configure.',
    );
  }

  await interaction.deferReply({ ephemeral: true });

  const prizeConfiguration: PrizeConfiguration = { mode: config.prizeCalculationMode };
  if (config.prizeCalculationValuePence !== null) prizeConfiguration.deductionPence = config.prizeCalculationValuePence;
  if (config.prizeCalculationValuePercent !== null) prizeConfiguration.deductionPercent = config.prizeCalculationValuePercent;

  const tournament = await createTournament(ctx.db, {
    guildId: interaction.guildId,
    name,
    date: dateISO,
    entryFeePence,
    prizeConfiguration,
    schedule: DEFAULT_SCHEDULE,
    status: 'DRAFT',
  });

  const correlationId = newCorrelationId();
  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: interaction.guildId,
    tournamentId: tournament.id,
    actorType: 'ADMIN',
    actorDiscordId: interaction.user.id,
    action: 'tournament.create',
    targetEntityType: 'tournament',
    targetEntityId: tournament.id,
    afterState: { name, date: dateISO, entryFeePence },
    correlationId,
    interactionId: interaction.id,
  });

  // DRAFT -> PUBLISHED -> (PREMIUM_SIGNUP | GENERAL_SIGNUP) depending on current time vs premium cutoff.
  assertTournamentTransition('DRAFT', 'PUBLISHED');
  const published = await updateTournamentStatus(ctx.db, tournament.id, tournament.version, 'PUBLISHED');

  const schedule = resolveSchedule(dateISO, DEFAULT_SCHEDULE, config.timezone);
  const now = DateTime.now().setZone(config.timezone);
  const initialSignupStatus = now < schedule.premiumCutoff ? 'PREMIUM_SIGNUP' : 'GENERAL_SIGNUP';
  assertTournamentTransition('PUBLISHED', initialSignupStatus);
  const live = await updateTournamentStatus(ctx.db, published.id, published.version, initialSignupStatus);

  const channel = await interaction.guild.channels.fetch(channelId);
  if (!channel?.isTextBased()) {
    throw new ValidationError('The target channel is not a text channel the bot can post in.');
  }

  const entries = await getEntriesByTournament(ctx.db, live.id);
  const message = await channel.send({
    embeds: [buildAnnouncementEmbed(live, entries, config)],
    components: buildAnnouncementComponents(live.id),
  });

  await updateTournamentAnnouncement(ctx.db, live.id, channel.id, message.id);

  // Section 32: the tournament clock is entirely scheduler-driven — nothing
  // fires automatically unless enqueued here. SIGNUP_CLOSE and GROUP_PUBLISH
  // share the same default run time; both handlers are written to tolerate
  // running in either order (see their own idempotency guards).
  for (const [jobType, runAt] of [
    ['PREMIUM_CUTOFF', schedule.premiumCutoff],
    ['SIGNUP_CLOSE', schedule.signupClose],
    ['GROUP_PUBLISH', schedule.groupPublish],
  ] as const) {
    await ctx.scheduler.enqueue({
      tournamentId: live.id,
      jobType,
      runAt: runAt.toJSDate(),
      idempotencyKey: `${jobType}:${live.id}`,
      payload: {},
    });
  }

  await interaction.followUp({
    content: `✅ Tournament **${name}** created and published in <#${channel.id}>.`,
    ephemeral: true,
  });
}
