import type { PrizeConfiguration } from '../../database/schema/tournaments.js';

export interface PrizePoolResult {
  /** Total pence collected from confirmed-paid teams (before any deduction). */
  grossPence: number;
  /** Final prize pool after applying the configured calculation mode. */
  netPence: number;
  isManualOverride: boolean;
  overrideReason?: string;
}

/**
 * Section 9: "public projected prize pool should default to confirmed
 * teams × fee. Do not assume an organiser deduction." Every other mode is
 * an explicit opt-in staff configuration.
 */
export function calculatePrizePool(
  config: PrizeConfiguration,
  confirmedTeamCount: number,
  entryFeePence: number,
): PrizePoolResult {
  const grossPence = confirmedTeamCount * entryFeePence;

  if (config.mode === 'MANUAL' && config.manualOverridePence !== undefined) {
    return {
      grossPence,
      netPence: config.manualOverridePence,
      isManualOverride: true,
      ...(config.manualOverrideReason !== undefined ? { overrideReason: config.manualOverrideReason } : {}),
    };
  }

  switch (config.mode) {
    case 'CONFIRMED_TEAMS_TIMES_FEE':
      return { grossPence, netPence: grossPence, isManualOverride: false };
    case 'FIXED_DEDUCTION': {
      const deduction = config.deductionPence ?? 0;
      return { grossPence, netPence: Math.max(0, grossPence - deduction), isManualOverride: false };
    }
    case 'PERCENTAGE_DEDUCTION': {
      const percent = config.deductionPercent ?? 0;
      const netPence = Math.round(grossPence * (1 - percent / 100));
      return { grossPence, netPence: Math.max(0, netPence), isManualOverride: false };
    }
    case 'FIXED_AMOUNT':
      return { grossPence, netPence: config.fixedAmountPence ?? 0, isManualOverride: false };
    default:
      return { grossPence, netPence: grossPence, isManualOverride: false };
  }
}

export function formatPence(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
