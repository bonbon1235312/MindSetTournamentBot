import { DateTime } from 'luxon';
import type { TemplateSchedule, ScheduleTimeOfDay } from '../../database/schema/tournament-templates.js';

export type ResolvedSchedule = Record<keyof TemplateSchedule, DateTime>;

/**
 * Converts a tournament's stored {hour,minute} schedule + its date string
 * into real zoned DateTimes, correctly handling BST/GMT transitions because
 * we construct each DateTime directly in the target zone via Luxon rather
 * than doing manual UTC-offset arithmetic (section 2's DST requirement).
 *
 * `cleanup` is defined as 00:00 the day AFTER the tournament date (section
 * 4: "Midnight cleanup: 12:00 AM" following an evening of play) — every
 * other slot is same-day.
 */
export function resolveSchedule(
  dateISO: string,
  schedule: TemplateSchedule,
  timezone: string,
): ResolvedSchedule {
  const baseDate = DateTime.fromISO(dateISO, { zone: timezone });
  if (!baseDate.isValid) {
    throw new Error(`Invalid tournament date "${dateISO}": ${baseDate.invalidReason}`);
  }

  const at = (time: ScheduleTimeOfDay, rollToNextDay = false): DateTime => {
    const day = rollToNextDay ? baseDate.plus({ days: 1 }) : baseDate;
    return day.set({ hour: time.hour, minute: time.minute, second: 0, millisecond: 0 });
  };

  return {
    premiumCutoff: at(schedule.premiumCutoff),
    paymentDeadline: at(schedule.paymentDeadline),
    signupClose: at(schedule.signupClose),
    groupPublish: at(schedule.groupPublish),
    roundOne: at(schedule.roundOne),
    roundTwo: at(schedule.roundTwo),
    roundThree: at(schedule.roundThree),
    cleanup: at(schedule.cleanup, true),
  };
}

/** Discord timestamp markup, e.g. "<t:1234567890:F>". */
export function discordTimestamp(dt: DateTime, style: 'F' | 'R' | 't' | 'd' = 'F'): string {
  return `<t:${Math.floor(dt.toSeconds())}:${style}>`;
}
