import type { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandSubcommandsOnlyBuilder } from 'discord.js';
import type { AppContext } from '../../types/context.js';
import { setupCommand, executeSetupCommand } from './setup.js';
import { tournamentCommand, executeTournamentCommand } from './tournament.js';
import { paymentsCommand, executePaymentsCommand } from './payments.js';

export interface AppCommand {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (interaction: ChatInputCommandInteraction, ctx: AppContext) => Promise<void>;
}

export const commands: AppCommand[] = [
  { data: setupCommand, execute: executeSetupCommand },
  { data: tournamentCommand, execute: executeTournamentCommand },
  { data: paymentsCommand, execute: executePaymentsCommand },
];
