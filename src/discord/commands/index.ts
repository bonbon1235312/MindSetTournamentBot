import type {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import type { AppContext } from '../../types/context.js';
import { setupCommand, executeSetupCommand } from './setup.js';
import { tournamentCommand, executeTournamentCommand } from './tournament.js';
import { paymentsCommand, executePaymentsCommand } from './payments.js';
import { ticketCommand, executeTicketCommand } from './ticket.js';

export interface AppCommand {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction, ctx: AppContext) => Promise<void>;
}

export const commands: AppCommand[] = [
  { data: setupCommand, execute: executeSetupCommand },
  { data: tournamentCommand, execute: executeTournamentCommand },
  { data: paymentsCommand, execute: executePaymentsCommand },
  { data: ticketCommand, execute: executeTicketCommand },
];
