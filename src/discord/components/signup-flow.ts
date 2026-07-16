import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  type ButtonInteraction,
  type ModalSubmitInteraction,
  type UserSelectMenuInteraction,
  type MessageActionRowComponentBuilder,
} from 'discord.js';
import { DateTime } from 'luxon';
import type { AppContext } from '../../types/context.js';
import { encodeCustomId } from '../interactions/custom-id.js';
import { getTournamentById } from '../../database/repositories/tournament-repository.js';
import { getOrCreateGuildConfig } from '../../database/repositories/guild-config-repository.js';
import { findActiveBan } from '../../database/repositories/ban-repository.js';
import { findActiveEntryForUser, findActiveEntryByClubId, createEntry } from '../../database/repositories/entry-repository.js';
import { findOrCreateClub } from '../../database/repositories/club-repository.js';
import { getActiveRulesVersion } from '../../database/repositories/rules-repository.js';
import { validateTeamName } from '../../domain/entries/team-name.js';
import { applyTournamentNickname } from '../../services/nickname-service.js';
import { refreshTournamentAnnouncement } from '../../services/tournament-announcement-service.js';
import { recordAuditEvent, newCorrelationId } from '../../domain/audit/audit-log.js';
import { resolveSchedule } from '../../domain/tournaments/schedule.js';
import {
  AlreadyRegisteredError,
  BannedError,
  DuplicateTeamNameError,
  NicknameRoleHierarchyError,
  SignupClosedError,
  ValidationError,
} from '../../types/errors.js';
import { DEFAULT_BRANDING } from '../../config/constants.js';
import type { TemplateSchedule } from '../../database/schema/tournament-templates.js';

const NAMESPACE = 'signup';
const SIGNUP_ACCEPTING_STATUSES = ['PUBLISHED', 'PREMIUM_SIGNUP', 'GENERAL_SIGNUP'];

interface SignupDraft {
  teamDisplayName: string;
  clubId: string;
  coManagerUserId: string | null;
  createdAt: number;
}

/** Ephemeral, per-user wizard state for the FEW SECONDS a manager spends
 * clicking through Sign Up -> name -> co-manager -> rules. This is UI
 * session state, not production tournament data — the real entry is
 * written to Postgres exactly once, atomically, only after rules are
 * accepted (section 7, item 7: "Require explicit acceptance before
 * creating the entry"). A restart mid-wizard simply means the manager
 * clicks Sign Up again; nothing persisted is ever lost. */
const drafts = new Map<string, SignupDraft>();
const DRAFT_TTL_MS = 15 * 60 * 1000;

function draftKey(tournamentId: string, userId: string): string {
  return `${tournamentId}:${userId}`;
}

function getDraft(tournamentId: string, userId: string): SignupDraft | undefined {
  const key = draftKey(tournamentId, userId);
  const draft = drafts.get(key);
  if (!draft) return undefined;
  if (Date.now() - draft.createdAt > DRAFT_TTL_MS) {
    drafts.delete(key);
    return undefined;
  }
  return draft;
}

async function assertCanSignUp(ctx: AppContext, tournamentId: string, userId: string) {
  const tournament = await getTournamentById(ctx.db, tournamentId);
  if (!tournament || !SIGNUP_ACCEPTING_STATUSES.includes(tournament.status) || tournament.paused) {
    throw new SignupClosedError();
  }

  const ban = await findActiveBan(ctx.db, tournament.guildId, userId, undefined);
  if (ban) throw new BannedError(ban.reason);

  const existing = await findActiveEntryForUser(ctx.db, tournamentId, userId);
  if (existing) throw new AlreadyRegisteredError();

  return tournament;
}

export async function handleSignupButton(
  interaction: ButtonInteraction,
  ctx: AppContext,
  tournamentId: string,
): Promise<void> {
  await assertCanSignUp(ctx, tournamentId, interaction.user.id);

  const modal = new ModalBuilder()
    .setCustomId(encodeCustomId(NAMESPACE, 'name_modal', tournamentId))
    .setTitle('Sign Up — Team Name')
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId('team_name')
          .setLabel('Team name')
          .setStyle(TextInputStyle.Short)
          .setMaxLength(40)
          .setRequired(true),
      ),
    );

  await interaction.showModal(modal);
}

export async function handleSignupNameModal(
  interaction: ModalSubmitInteraction,
  ctx: AppContext,
  tournamentId: string,
): Promise<void> {
  const tournament = await assertCanSignUp(ctx, tournamentId, interaction.user.id);
  const raw = interaction.fields.getTextInputValue('team_name');
  const { displayName, normalisedName } = validateTeamName(raw);

  const club = await findOrCreateClub(ctx.db, tournament.guildId, displayName, normalisedName);

  const duplicateEntry = await findActiveEntryByClubId(ctx.db, tournamentId, club.id);
  if (duplicateEntry) throw new DuplicateTeamNameError();

  drafts.set(draftKey(tournamentId, interaction.user.id), {
    teamDisplayName: displayName,
    clubId: club.id,
    coManagerUserId: null,
    createdAt: Date.now(),
  });

  const embed = new EmbedBuilder()
    .setColor(DEFAULT_BRANDING.primaryColor as `#${string}`)
    .setTitle(`Signing up "${displayName}"`)
    .setDescription('Optionally search for a co-manager, or skip. The co-manager can submit results and confirm your group alongside you.');

  const rows: ActionRowBuilder<MessageActionRowComponentBuilder>[] = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new UserSelectMenuBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'comanager_select', tournamentId))
        .setPlaceholder('Search for your co-manager')
        .setMinValues(1)
        .setMaxValues(1),
    ),
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'comanager_skip', tournamentId))
        .setLabel('Skip co-manager')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'cancel', tournamentId))
        .setLabel('Cancel signup')
        .setStyle(ButtonStyle.Danger),
    ),
  ];

  await interaction.reply({ embeds: [embed], components: rows, ephemeral: true });
}

async function proceedToRules(
  interaction: UserSelectMenuInteraction | ButtonInteraction,
  ctx: AppContext,
  tournamentId: string,
): Promise<void> {
  const draft = getDraft(tournamentId, interaction.user.id);
  if (!draft) throw new ValidationError('Your signup session expired. Press Sign Up again.');

  const rules = await getActiveRulesVersion(ctx.db, (await getOrCreateGuildConfig(ctx.db, interaction.guildId!)).guildId);

  const embed = new EmbedBuilder()
    .setColor(DEFAULT_BRANDING.primaryColor as `#${string}`)
    .setTitle(rules.title)
    .setDescription(rules.content)
    .setFooter({ text: `Team: ${draft.teamDisplayName}${draft.coManagerUserId ? ` · Co-manager: <@${draft.coManagerUserId}>` : ''}` });

  const rows = [
    new ActionRowBuilder<MessageActionRowComponentBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'accept_rules', tournamentId))
        .setLabel('Accept Rules & Complete Signup')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(encodeCustomId(NAMESPACE, 'cancel', tournamentId))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Danger),
    ),
  ];

  if (interaction.isButton()) {
    await interaction.update({ embeds: [embed], components: rows });
  } else {
    await interaction.update({ embeds: [embed], components: rows });
  }
}

export async function handleCoManagerSelect(
  interaction: UserSelectMenuInteraction,
  ctx: AppContext,
  tournamentId: string,
): Promise<void> {
  const draft = getDraft(tournamentId, interaction.user.id);
  if (!draft) throw new ValidationError('Your signup session expired. Press Sign Up again.');

  const coManagerId = interaction.values[0]!;
  if (coManagerId === interaction.user.id) {
    throw new ValidationError('You cannot be your own co-manager.');
  }

  const existing = await findActiveEntryForUser(ctx.db, tournamentId, coManagerId);
  if (existing) {
    throw new ValidationError('That member is already manager or co-manager of another team in this tournament.');
  }

  draft.coManagerUserId = coManagerId;
  await proceedToRules(interaction, ctx, tournamentId);
}

export async function handleCoManagerSkip(
  interaction: ButtonInteraction,
  ctx: AppContext,
  tournamentId: string,
): Promise<void> {
  await proceedToRules(interaction, ctx, tournamentId);
}

export async function handleCancelSignup(
  interaction: ButtonInteraction,
  _ctx: AppContext,
  tournamentId: string,
): Promise<void> {
  drafts.delete(draftKey(tournamentId, interaction.user.id));
  await interaction.update({ content: '❌ Signup cancelled.', embeds: [], components: [] });
}

export async function handleAcceptRules(
  interaction: ButtonInteraction,
  ctx: AppContext,
  tournamentId: string,
): Promise<void> {
  const tournament = await assertCanSignUp(ctx, tournamentId, interaction.user.id);
  const draft = getDraft(tournamentId, interaction.user.id);
  if (!draft) throw new ValidationError('Your signup session expired. Press Sign Up again.');

  const guildConfig = await getOrCreateGuildConfig(ctx.db, tournament.guildId);
  const rules = await getActiveRulesVersion(ctx.db, tournament.guildId);

  const schedule = resolveSchedule(tournament.date, tournament.schedule as TemplateSchedule, guildConfig.timezone);
  const now = DateTime.now().setZone(guildConfig.timezone);
  const premiumAtSignup = now < schedule.premiumCutoff;

  const entry = await createEntry(ctx.db, {
    tournamentId,
    clubId: draft.clubId,
    managerUserId: interaction.user.id,
    coManagerUserId: draft.coManagerUserId,
    premiumAtSignup,
    rulesVersionId: rules.id,
    entryStatus: 'AWAITING_PAYMENT',
    paymentStatus: 'AWAITING_PAYMENT',
  });

  const correlationId = newCorrelationId();
  await recordAuditEvent(ctx.db, ctx.logger, {
    guildId: tournament.guildId,
    tournamentId,
    actorType: 'USER',
    actorDiscordId: interaction.user.id,
    action: 'entry.signup',
    targetEntityType: 'tournament_entry',
    targetEntityId: entry.id,
    afterState: { teamName: draft.teamDisplayName, coManagerUserId: draft.coManagerUserId, premiumAtSignup },
    correlationId,
    interactionId: interaction.id,
  });

  drafts.delete(draftKey(tournamentId, interaction.user.id));

  const warnings: string[] = [];
  if (guildConfig.participantRoleId) {
    try {
      const managerMember = await interaction.guild!.members.fetch(interaction.user.id);
      await managerMember.roles.add(guildConfig.participantRoleId);
      if (draft.coManagerUserId) {
        const coMember = await interaction.guild!.members.fetch(draft.coManagerUserId);
        await coMember.roles.add(guildConfig.participantRoleId);
      }
    } catch (error) {
      ctx.logger.warn({ error, tournamentId }, 'Failed to assign participant role');
      warnings.push('Could not assign the Cash Cup Participant role — ask staff to add it manually.');
    }
  }

  try {
    await applyTournamentNickname(interaction.guild!, ctx.db, ctx.logger, tournamentId, interaction.user.id, draft.teamDisplayName, 'MANAGER');
  } catch (error) {
    if (error instanceof NicknameRoleHierarchyError) warnings.push(error.message);
    else throw error;
  }
  if (draft.coManagerUserId) {
    try {
      await applyTournamentNickname(interaction.guild!, ctx.db, ctx.logger, tournamentId, draft.coManagerUserId, draft.teamDisplayName, 'CO_MANAGER');
    } catch (error) {
      if (error instanceof NicknameRoleHierarchyError) warnings.push(`Co-manager: ${error.message}`);
      else throw error;
    }
  }

  // DM both users — best effort, never fails signup (section 7).
  const dmEmbed = new EmbedBuilder()
    .setColor(DEFAULT_BRANDING.accentColor as `#${string}`)
    .setTitle(`You're signed up: ${draft.teamDisplayName}`)
    .setDescription(`Tournament: **${tournament.name}**\nPay your £${(tournament.entryFeePence / 100).toFixed(2)} entry fee via PayPal or Revolut, then wait for staff to confirm it.`);
  await interaction.user.send({ embeds: [dmEmbed] }).catch(() => undefined);
  if (draft.coManagerUserId) {
    const coUser = await ctx.client.users.fetch(draft.coManagerUserId).catch(() => undefined);
    await coUser?.send({ embeds: [dmEmbed] }).catch(() => undefined);
  }

  await refreshTournamentAnnouncement(ctx.client, ctx.db, ctx.logger, tournamentId);

  const confirmEmbed = new EmbedBuilder()
    .setColor(DEFAULT_BRANDING.successColor as `#${string}`)
    .setTitle('✅ Signup complete')
    .setDescription(
      [
        `**${draft.teamDisplayName}** is registered — awaiting payment confirmation.`,
        `Pay £${(tournament.entryFeePence / 100).toFixed(2)} via PayPal or Revolut, then wait for staff.`,
        ...warnings.map((w) => `⚠️ ${w}`),
      ].join('\n'),
    );

  await interaction.update({ embeds: [confirmEmbed], components: [] });
}
