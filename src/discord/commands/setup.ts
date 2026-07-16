import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type MessageActionRowComponentBuilder,
  type AnySelectMenuInteraction,
  type ButtonInteraction,
} from 'discord.js';
import type { AppContext } from '../../types/context.js';
import { getOrCreateGuildConfig, updateGuildConfig, checkGuildConfigStatus } from '../../database/repositories/guild-config-repository.js';
import { isStaffMember } from '../permissions/staff.js';
import { decodeCustomId, encodeCustomId } from '../interactions/custom-id.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import { PermissionError } from '../../types/errors.js';
import { DEFAULT_BRANDING } from '../../config/constants.js';

const NAMESPACE = 'setup';
const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] as const;

export const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure MindSet Tournament Bot for this server (staff only)')
  .addSubcommand((sub) => sub.setName('configure').setDescription('Open the setup wizard'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Show missing configuration'));

function page1Rows(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'admin_roles'))
        .setPlaceholder('Select admin/staff role(s)')
        .setMinValues(1)
        .setMaxValues(10),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'premium_role'))
        .setPlaceholder('Select the Premium priority role')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new RoleSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'participant_role'))
        .setPlaceholder('Select the Cash Cup Participant role')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'rules_channel'))
        .setPlaceholder('Select the rules channel')
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'nav', 'page2'))
        .setLabel('Next: Categories & Log →')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function page2Rows(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'audit_channel'))
        .setPlaceholder('Select the audit-log channel')
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'group_category'))
        .setPlaceholder('Select the group-stage category')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'knockout_category'))
        .setPlaceholder('Select the knockout category')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'staff_category'))
        .setPlaceholder('Select the staff-only category')
        .addChannelTypes(ChannelType.GuildCategory)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'nav', 'page1'))
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'nav', 'page3'))
        .setLabel('Next: Weekday Channels →')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function page3Rows(): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'weekday_pick'))
        .setPlaceholder('Pick a weekday to assign its tournament channel')
        .addOptions(WEEKDAYS.map((day) => ({ label: day[0]!.toUpperCase() + day.slice(1), value: day }))),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'nav', 'page2'))
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'nav', 'done'))
        .setLabel('Finish')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

function weekdayChannelRow(day: string): ActionRowBuilder<MessageActionRowComponentBuilder>[] {
  return [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'weekday_channel', day))
        .setPlaceholder(`Select the ${day} tournament channel`)
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'nav', 'page3'))
        .setLabel('← Back to weekday list')
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function pageEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder().setColor(DEFAULT_BRANDING.primaryColor as `#${string}`).setTitle(title).setDescription(description);
}

export async function executeSetupCommand(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
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

  if (subcommand === 'status') {
    const status = checkGuildConfigStatus(config);
    const embed = pageEmbed(
      'Setup Status',
      status.configured
        ? '✅ Everything required is configured. Tournaments can be published.'
        : `⚠️ Missing configuration:\n${status.missing.map((m) => `• ${m}`).join('\n')}\n\nRun \`/setup configure\` to fix this.`,
    );
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  await interaction.reply({
    embeds: [pageEmbed('MindSet Tournament Bot Setup — Page 1/3', 'Roles & rules channel. Every selection saves immediately.')],
    components: page1Rows(),
    ephemeral: true,
  });
}

/** Handles every setup:* component interaction (selects + nav buttons). */
export async function handleSetupComponent(
  interaction: AnySelectMenuInteraction | ButtonInteraction,
  ctx: AppContext,
): Promise<void> {
  if (!interaction.inGuild() || !interaction.guild) return;

  const config = await getOrCreateGuildConfig(ctx.db, interaction.guildId);
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (!isStaffMember(member, config)) {
    throw new PermissionError('Staff management only.');
  }

  const { action, parts } = decodeCustomId(interaction.customId);
  const correlationId = newCorrelationId();

  const auditAndSave = async (changes: Parameters<typeof updateGuildConfig>[2], fieldLabel: string) => {
    await updateGuildConfig(ctx.db, interaction.guildId!, changes);
    await recordAuditEvent(ctx.db, ctx.logger, {
      guildId: interaction.guildId!,
      actorType: 'ADMIN',
      actorDiscordId: interaction.user.id,
      action: 'setup.update',
      targetEntityType: 'guild_config',
      targetEntityId: interaction.guildId!,
      afterState: changes,
      reason: `Updated ${fieldLabel} via /setup wizard`,
      correlationId,
      interactionId: interaction.id,
    });
  };

  switch (action) {
    case 'admin_roles': {
      if (!interaction.isRoleSelectMenu()) return;
      await auditAndSave({ adminRoleIds: interaction.values }, 'admin roles');
      await interaction.reply({ content: `✅ Admin roles set: ${interaction.values.map((r) => `<@&${r}>`).join(', ')}`, ephemeral: true });
      return;
    }
    case 'premium_role': {
      if (!interaction.isRoleSelectMenu()) return;
      await auditAndSave({ premiumRoleId: interaction.values[0]! }, 'premium role');
      await interaction.reply({ content: `✅ Premium role set to <@&${interaction.values[0]}>`, ephemeral: true });
      return;
    }
    case 'participant_role': {
      if (!interaction.isRoleSelectMenu()) return;
      await auditAndSave({ participantRoleId: interaction.values[0]! }, 'participant role');
      await interaction.reply({ content: `✅ Participant role set to <@&${interaction.values[0]}>`, ephemeral: true });
      return;
    }
    case 'rules_channel': {
      if (!interaction.isChannelSelectMenu()) return;
      await auditAndSave({ rulesChannelId: interaction.values[0]! }, 'rules channel');
      await interaction.reply({ content: `✅ Rules channel set to <#${interaction.values[0]}>`, ephemeral: true });
      return;
    }
    case 'audit_channel': {
      if (!interaction.isChannelSelectMenu()) return;
      await auditAndSave({ auditLogChannelId: interaction.values[0]! }, 'audit log channel');
      await interaction.reply({ content: `✅ Audit log channel set to <#${interaction.values[0]}>`, ephemeral: true });
      return;
    }
    case 'group_category': {
      if (!interaction.isChannelSelectMenu()) return;
      await auditAndSave({ groupCategoryId: interaction.values[0]! }, 'group category');
      await interaction.reply({ content: `✅ Group category set.`, ephemeral: true });
      return;
    }
    case 'knockout_category': {
      if (!interaction.isChannelSelectMenu()) return;
      await auditAndSave({ knockoutCategoryId: interaction.values[0]! }, 'knockout category');
      await interaction.reply({ content: `✅ Knockout category set.`, ephemeral: true });
      return;
    }
    case 'staff_category': {
      if (!interaction.isChannelSelectMenu()) return;
      await auditAndSave({ staffCategoryId: interaction.values[0]! }, 'staff category');
      await interaction.reply({ content: `✅ Staff category set.`, ephemeral: true });
      return;
    }
    case 'weekday_pick': {
      if (!interaction.isStringSelectMenu()) return;
      const day = interaction.values[0]!;
      await interaction.update({
        embeds: [pageEmbed(`Weekday Channel — ${day[0]!.toUpperCase() + day.slice(1)}`, 'Select the tournament announcement channel for this weekday.')],
        components: weekdayChannelRow(day),
      });
      return;
    }
    case 'weekday_channel': {
      if (!interaction.isChannelSelectMenu()) return;
      const day = parts[0]!;
      const updatedChannels = { ...config.tournamentChannels, [day]: interaction.values[0]! };
      await auditAndSave({ tournamentChannels: updatedChannels }, `${day} tournament channel`);
      await interaction.reply({ content: `✅ ${day[0]!.toUpperCase() + day.slice(1)} channel set to <#${interaction.values[0]}>`, ephemeral: true });
      return;
    }
    case 'nav': {
      if (!interaction.isButton()) return;
      const target = parts[0];
      if (target === 'page1') {
        await interaction.update({ embeds: [pageEmbed('MindSet Tournament Bot Setup — Page 1/3', 'Roles & rules channel.')], components: page1Rows() });
      } else if (target === 'page2') {
        await interaction.update({ embeds: [pageEmbed('MindSet Tournament Bot Setup — Page 2/3', 'Categories & audit log.')], components: page2Rows() });
      } else if (target === 'page3') {
        await interaction.update({ embeds: [pageEmbed('MindSet Tournament Bot Setup — Page 3/3', 'Weekday tournament channels.')], components: page3Rows() });
      } else if (target === 'done') {
        const refreshed = await getOrCreateGuildConfig(ctx.db, interaction.guildId!);
        const status = checkGuildConfigStatus(refreshed);
        await interaction.update({
          embeds: [
            pageEmbed(
              'Setup Complete',
              status.configured
                ? '✅ Everything required is configured.'
                : `⚠️ Still missing:\n${status.missing.map((m) => `• ${m}`).join('\n')}\n\nRun \`/setup configure\` again any time.`,
            ),
          ],
          components: [],
        });
      }
      return;
    }
  }
}
