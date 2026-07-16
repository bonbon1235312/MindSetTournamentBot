import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  EmbedBuilder,
  RoleSelectMenuBuilder,
  SlashCommandBuilder,
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

export const setupCommand = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure MindSet Tournament Bot for this server (staff only)')
  .addSubcommand((sub) => sub.setName('configure').setDescription('Open the setup wizard'))
  .addSubcommand((sub) => sub.setName('status').setDescription('Show missing configuration'));

/**
 * Only two pages now — section 12's group-stage/knockout/staff categories
 * are NOT configured here (the bot creates and remembers those itself the
 * first time it needs one, see discord-resource-service.ts). This wizard
 * only covers what genuinely can't be inferred: roles, the rules channel,
 * the audit log, and the one channel a cup gets posted in.
 */
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
        .setLabel('Next: Channels →')
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
        .setCustomId(encodeCustomId(NAMESPACE, 'tournament_channel'))
        .setPlaceholder('Select the tournament sign-up channel')
        .addChannelTypes(ChannelType.GuildText)
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'nav', 'page1'))
        .setLabel('← Back')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'nav', 'done'))
        .setLabel('Finish')
        .setStyle(ButtonStyle.Success),
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
    embeds: [pageEmbed('MindSet Tournament Bot Setup — Page 1/2', 'Roles & rules channel. Every selection saves immediately.')],
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
    case 'tournament_channel': {
      if (!interaction.isChannelSelectMenu()) return;
      await auditAndSave({ tournamentChannelId: interaction.values[0]! }, 'tournament channel');
      await interaction.reply({ content: `✅ Tournament channel set to <#${interaction.values[0]}>`, ephemeral: true });
      return;
    }
    case 'nav': {
      if (!interaction.isButton()) return;
      const target = parts[0];
      if (target === 'page1') {
        await interaction.update({ embeds: [pageEmbed('MindSet Tournament Bot Setup — Page 1/2', 'Roles & rules channel.')], components: page1Rows() });
      } else if (target === 'page2') {
        await interaction.update({ embeds: [pageEmbed('MindSet Tournament Bot Setup — Page 2/2', 'Audit log & tournament channel.')], components: page2Rows() });
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
