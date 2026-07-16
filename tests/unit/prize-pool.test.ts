import { describe, it, expect } from 'vitest';
import { calculatePrizePool, formatPence } from '../../src/domain/payments/prize-pool.js';

describe('calculatePrizePool', () => {
  it('defaults to confirmed teams x fee with no assumed deduction', () => {
    const result = calculatePrizePool({ mode: 'CONFIRMED_TEAMS_TIMES_FEE' }, 10, 1500);
    expect(result.grossPence).toBe(15000);
    expect(result.netPence).toBe(15000);
    expect(result.isManualOverride).toBe(false);
  });

  it('applies a fixed organiser deduction', () => {
    const result = calculatePrizePool({ mode: 'FIXED_DEDUCTION', deductionPence: 2000 }, 10, 1500);
    expect(result.grossPence).toBe(15000);
    expect(result.netPence).toBe(13000);
  });

  it('never lets a fixed deduction push the net pool negative', () => {
    const result = calculatePrizePool({ mode: 'FIXED_DEDUCTION', deductionPence: 999999 }, 2, 1500);
    expect(result.netPence).toBe(0);
  });

  it('applies a percentage deduction', () => {
    const result = calculatePrizePool({ mode: 'PERCENTAGE_DEDUCTION', deductionPercent: 20 }, 10, 1500);
    expect(result.grossPence).toBe(15000);
    expect(result.netPence).toBe(12000);
  });

  it('uses a fixed prize amount regardless of confirmed team count', () => {
    const result = calculatePrizePool({ mode: 'FIXED_AMOUNT', fixedAmountPence: 50000 }, 3, 1500);
    expect(result.netPence).toBe(50000);
    expect(result.grossPence).toBe(4500);
  });

  it('honours a manual override and marks it clearly', () => {
    const result = calculatePrizePool({ mode: 'MANUAL', manualOverridePence: 100000, manualOverrideReason: 'Sponsor top-up' }, 10, 1500);
    expect(result.netPence).toBe(100000);
    expect(result.isManualOverride).toBe(true);
    expect(result.overrideReason).toBe('Sponsor top-up');
  });

  it('computes a zero pool correctly when nobody has paid yet', () => {
    const result = calculatePrizePool({ mode: 'CONFIRMED_TEAMS_TIMES_FEE' }, 0, 1500);
    expect(result.grossPence).toBe(0);
    expect(result.netPence).toBe(0);
  });
});

describe('formatPence', () => {
  it('formats whole pounds', () => {
    expect(formatPence(150000)).toBe('£1500.00');
  });

  it('formats an entry fee correctly', () => {
    expect(formatPence(1500)).toBe('£15.00');
  });

  it('formats zero correctly', () => {
    expect(formatPence(0)).toBe('£0.00');
  });
});
