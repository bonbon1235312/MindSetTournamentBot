/**
 * System-wide defaults. Every value here is overridable per-guild
 * (guild_configs) or per-template (tournament_templates) in the database —
 * nothing here is a hardcoded Discord ID or secret, only sane fallbacks.
 */

export const DEFAULT_TIMEZONE = 'Europe/London';

/** Default tournament schedule, expressed as { hour, minute } in the
 * tournament's timezone. Stored per-template so staff can change them. */
export const DEFAULT_SCHEDULE = {
  premiumCutoff: { hour: 19, minute: 0 }, // 7:00 PM
  paymentDeadline: { hour: 20, minute: 40 }, // 8:40 PM
  signupClose: { hour: 21, minute: 0 }, // 9:00 PM
  groupPublish: { hour: 21, minute: 0 }, // 9:00 PM
  roundOne: { hour: 21, minute: 15 }, // 9:15 PM
  roundTwo: { hour: 21, minute: 45 }, // 9:45 PM
  roundThree: { hour: 22, minute: 10 }, // 10:10 PM
  cleanup: { hour: 0, minute: 0 }, // 12:00 AM (next day)
} as const;

export const DEFAULT_ENTRY_FEE_PENCE = 1500; // £15.00

export const GROUP_CONFIRMATION_REMINDER_OFFSETS_MINUTES = [3, 6, 9, 12] as const;
export const GROUP_CONFIRMATION_DEADLINE_MINUTES = 15;

export const RESULT_FIRST_REMINDER_MINUTES = 30;
export const RESULT_STAFF_ALERT_MINUTES = 35;

export const PRIZE_DETAILS_DEADLINE_HOURS = 24;

export const TEAM_NAME_MAX_LENGTH = 40;
export const NICKNAME_MAX_LENGTH = 32; // Discord's hard limit
export const MANAGER_SUFFIX = ' M';
export const CO_MANAGER_SUFFIX = ' CO';

export const GROUP_SIZE = 4;
export const MATCHES_PER_GROUP = 6;
export const ROUNDS_PER_GROUP = 3;

export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;
export const POINTS_LOSS = 0;

/** Conventional scoreline recorded for a forfeit win, so forfeited fixtures
 * flow through standings/qualification exactly like a normal result instead
 * of needing to be special-cased. */
export const FORFEIT_WIN_SCORE = 3;
export const FORFEIT_LOSS_SCORE = 0;

export const GRAPHIC_DIMENSIONS = { width: 1080, height: 1080 } as const;
export const KNOCKOUT_GRAPHIC_DIMENSIONS = { width: 1920, height: 1080 } as const;

export const DEFAULT_BRANDING = {
  primaryColor: '#0B1F3A',
  accentColor: '#FFC93C',
  successColor: '#2ECC71',
  dangerColor: '#C0392B',
  textColor: '#FFFFFF',
} as const;

/** Ticket system config (deliberately code-level, not DB/setup-driven —
 * the whole point is "no setup"). Add an entry here to add a new ticket
 * type; nothing else needs to change. */
export const TICKET_TYPES = [
  { id: 'support', label: 'General Support', emoji: '🎫', description: 'Questions or general help' },
  { id: 'payment', label: 'Payment Issue', emoji: '💳', description: 'Entry fee or prize payment problems' },
  { id: 'dispute', label: 'Report a Dispute', emoji: '⚠️', description: 'Match result or rule dispute' },
  { id: 'other', label: 'Other', emoji: '❓', description: 'Anything else' },
] as const;

export type TicketTypeId = (typeof TICKET_TYPES)[number]['id'];

export const TICKET_CATEGORY_NAME = 'Support Tickets';
/** Channel name fragment (case-insensitive) auto-detected for welcome and
 * goodbye messages — see discord/listeners/member-events.ts. No dedicated
 * "goodbye" channel is assumed to exist; leave events post to the same
 * channel as joins. */
export const WELCOME_CHANNEL_NAME_FRAGMENT = 'welcome';
