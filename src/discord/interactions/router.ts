import type { Interaction } from 'discord.js';
import type { AppContext } from '../../types/context.js';
import { commands } from '../commands/index.js';
import { decodeCustomId } from './custom-id.js';
import { isAppError, toUserMessage, InternalError } from '../../types/errors.js';
import { handleSetupComponent } from '../commands/setup.js';
import { handlePaymentsComponent } from '../commands/payments.js';
import {
  handleSignupButton,
  handleSignupNameModal,
  handleCoManagerSelect,
  handleCoManagerSkip,
  handleAcceptRules,
  handleCancelSignup,
} from '../components/signup-flow.js';
import {
  handleViewEntryButton,
  handleViewRulesButton,
  handleRefreshButton,
  handlePullOutButton,
  handlePullOutConfirm,
  handleCoManagerManageButton,
  handleCoManagerChangeSelect,
  handleAdminButton,
} from '../components/announcement-actions.js';
import { handleOpenTicketButton, handleClaimTicketButton, handleCloseTicketButton } from '../components/ticket-flow.js';
import {
  handleFixtureSelect,
  handleSubmitResultModal,
  handleStaffOverrideModal,
  handleFixtureStaffAction,
  handleConflictResolutionButton,
  handleConfirmGroupButton,
} from '../components/result-submission-flow.js';
import { handleConfirmRosterButton } from '../components/group-confirmation-flow.js';
import { handleRepairComponent } from '../commands/tournament-repair.js';

/**
 * Single entry point for every Discord interaction. This is the "global
 * interaction error boundary" (section 38) — every handler below can throw
 * an AppError (or anything else) and it's translated into a safe ephemeral
 * message here rather than leaking a raw stack trace to the user.
 */
export async function routeInteraction(interaction: Interaction, ctx: AppContext): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commands.find((c) => c.data.name === interaction.commandName);
      if (!command) return;
      await command.execute(interaction, ctx);
      return;
    }

    if (interaction.isAutocomplete()) return;

    if (
      interaction.isButton() ||
      interaction.isAnySelectMenu() ||
      interaction.isModalSubmit()
    ) {
      const { namespace, action, parts } = decodeCustomId(interaction.customId);

      switch (namespace) {
        case 'setup':
          if (interaction.isButton() || interaction.isAnySelectMenu()) {
            await handleSetupComponent(interaction, ctx);
          }
          return;

        case 'payments':
          if (interaction.isButton() || interaction.isAnySelectMenu() || interaction.isModalSubmit()) {
            await handlePaymentsComponent(interaction, ctx);
          }
          return;

        case 'signup': {
          const tournamentId = parts[0]!;
          if (action === 'name_modal' && interaction.isModalSubmit()) {
            await handleSignupNameModal(interaction, ctx, tournamentId);
          } else if (action === 'comanager_select' && interaction.isUserSelectMenu()) {
            await handleCoManagerSelect(interaction, ctx, tournamentId);
          } else if (action === 'comanager_skip' && interaction.isButton()) {
            await handleCoManagerSkip(interaction, ctx, tournamentId);
          } else if (action === 'accept_rules' && interaction.isButton()) {
            await handleAcceptRules(interaction, ctx, tournamentId);
          } else if (action === 'cancel' && interaction.isButton()) {
            await handleCancelSignup(interaction, ctx, tournamentId);
          }
          return;
        }

        case 'tournament': {
          const tournamentId = parts[0]!;
          if (!interaction.isButton()) return;
          if (action === 'signup') await handleSignupButton(interaction, ctx, tournamentId);
          else if (action === 'view_entry') await handleViewEntryButton(interaction, ctx, tournamentId);
          else if (action === 'view_rules') await handleViewRulesButton(interaction, ctx, tournamentId);
          else if (action === 'refresh') await handleRefreshButton(interaction, ctx, tournamentId);
          else if (action === 'pullout') await handlePullOutButton(interaction, ctx, tournamentId);
          else if (action === 'pullout_confirm') await handlePullOutConfirm(interaction, ctx, tournamentId);
          else if (action === 'comanager') await handleCoManagerManageButton(interaction, ctx, tournamentId);
          else if (action === 'admin') await handleAdminButton(interaction, ctx, tournamentId);
          return;
        }

        case 'ticket': {
          if (!interaction.isButton()) return;
          const ticketOrTypeId = parts[0]!;
          if (action === 'open') await handleOpenTicketButton(interaction, ctx, ticketOrTypeId);
          else if (action === 'claim') await handleClaimTicketButton(interaction, ctx, ticketOrTypeId);
          else if (action === 'close') await handleCloseTicketButton(interaction, ctx, ticketOrTypeId);
          return;
        }

        case 'comanager_change': {
          if (action === 'select' && interaction.isUserSelectMenu()) {
            const tournamentId = parts[0]!;
            const entryId = parts[1]!;
            await handleCoManagerChangeSelect(interaction, ctx, tournamentId, entryId);
          }
          return;
        }

        case 'fixture': {
          if (action === 'select' && interaction.isStringSelectMenu()) {
            await handleFixtureSelect(interaction, ctx);
          } else if (action === 'submit_modal' && interaction.isModalSubmit()) {
            const fixtureId = parts[0]!;
            await handleSubmitResultModal(interaction, ctx, fixtureId);
          } else if (action === 'staff_modal' && interaction.isModalSubmit()) {
            const fixtureId = parts[0]!;
            await handleStaffOverrideModal(interaction, ctx, fixtureId);
          } else if (
            (action === 'staff_enter_score' || action === 'staff_forfeit_home' || action === 'staff_forfeit_away' || action === 'staff_void') &&
            interaction.isButton()
          ) {
            const fixtureId = parts[0]!;
            await handleFixtureStaffAction(interaction, ctx, action, fixtureId);
          }
          return;
        }

        case 'result_conflict': {
          if (interaction.isButton()) {
            await handleConflictResolutionButton(interaction, ctx, parts[0]!);
          }
          return;
        }

        case 'group': {
          if (action === 'confirm' && interaction.isButton()) {
            await handleConfirmGroupButton(interaction, ctx, parts[0]!);
          } else if (action === 'confirm_roster' && interaction.isButton()) {
            await handleConfirmRosterButton(interaction, ctx, parts[0]!);
          }
          return;
        }

        case 'tournament_repair': {
          if (interaction.isButton()) {
            await handleRepairComponent(interaction, ctx);
          }
          return;
        }

        default:
          return;
      }
    }
  } catch (error) {
    await handleInteractionError(interaction, ctx, error);
  }
}

async function handleInteractionError(interaction: Interaction, ctx: AppContext, error: unknown): Promise<void> {
  const message = toUserMessage(error);

  if (!isAppError(error)) {
    ctx.logger.error({ error, interactionId: interaction.id }, 'Unhandled interaction error');
  } else if (!error.userFacing) {
    ctx.logger.error(
      { error: new InternalError(error.message).message, cause: error, interactionId: interaction.id },
      'Internal application error',
    );
  } else {
    ctx.logger.info({ code: error.code, interactionId: interaction.id }, 'Handled application error');
  }

  if (!('isRepliable' in interaction) || !interaction.isRepliable()) return;

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: `❌ ${message}`, ephemeral: true });
    } else {
      await interaction.reply({ content: `❌ ${message}`, ephemeral: true });
    }
  } catch (replyError) {
    ctx.logger.warn({ replyError, interactionId: interaction.id }, 'Failed to send error reply');
  }
}
