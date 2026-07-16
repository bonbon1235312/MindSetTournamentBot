import { pgEnum } from 'drizzle-orm/pg-core';

/** Section 45 — tournament state machine. */
export const tournamentStatusEnum = pgEnum('tournament_status', [
  'DRAFT',
  'PUBLISHED',
  'PREMIUM_SIGNUP',
  'GENERAL_SIGNUP',
  'PAYMENT_LOCKED',
  'SIGNUP_CLOSED',
  'GENERATING_GROUPS',
  'GROUP_CONFIRMATION',
  'GROUP_STAGE_LIVE',
  'CALCULATING_QUALIFIERS',
  'QUALIFICATION_REVIEW',
  'KNOCKOUT_LIVE',
  'FINAL_LIVE',
  'COMPLETED',
  'CANCELLED',
  'CLEANING_UP',
  'CLEANED',
]);

/** Section 45 — entry state machine. INACTIVE_PENDING_REPLACEMENT is the
 * group-confirmation-timeout state introduced in section 15. */
export const entryStatusEnum = pgEnum('entry_status', [
  'AWAITING_PAYMENT',
  'CONFIRMED',
  'RESERVE',
  'GROUPED',
  'ACTIVE',
  'INACTIVE_PENDING_REPLACEMENT',
  'WITHDRAWN',
  'KICKED',
  'DISQUALIFIED',
  'ELIMINATED',
  'WINNER',
]);

/** Section 45 — fixture state machine. */
export const fixtureStatusEnum = pgEnum('fixture_status', [
  'SCHEDULED',
  'READY',
  'WAITING_FOR_SUBMISSIONS',
  'WAITING_FOR_OPPONENT',
  'RESULT_CONFLICT',
  'EVIDENCE_REQUESTED',
  'OVERDUE',
  'RESOLVED',
  'FORFEIT',
  'VOID',
]);

/** Section 9 — payment state machine (also carries prize-payment states,
 * since a confirmed entry that goes on to win reuses the same lifecycle). */
export const paymentStatusEnum = pgEnum('payment_status', [
  'AWAITING_PAYMENT',
  'PAYMENT_CONFIRMED',
  'PAYMENT_REJECTED',
  'REFUND_DUE',
  'PARTIALLY_REFUNDED',
  'FULLY_REFUNDED',
  'PRIZE_PENDING',
  'PRIZE_PAID',
]);

/** Section 30 — audit actor type. */
export const actorTypeEnum = pgEnum('actor_type', ['USER', 'ADMIN', 'SYSTEM']);

/** Section 32 — scheduler job lifecycle. */
export const jobStatusEnum = pgEnum('job_status', [
  'PENDING',
  'CLAIMED',
  'RUNNING',
  'COMPLETED',
  'FAILED',
  'DEAD_LETTER',
]);

/** Section 32/47 — every distinct timed operation the scheduler can run. */
export const jobTypeEnum = pgEnum('job_type', [
  'PREMIUM_CUTOFF',
  'PAYMENT_DEADLINE',
  'SIGNUP_CLOSE',
  'GROUP_PUBLISH',
  'GROUP_CONFIRMATION_REMINDER',
  'GROUP_CONFIRMATION_DEADLINE',
  'FIXTURE_READY',
  'RESULT_FIRST_REMINDER',
  'RESULT_STAFF_ALERT',
  'PRIZE_DETAILS_DEADLINE',
  'MIDNIGHT_CLEANUP',
]);

/** Section 24 — knockout decision method. */
export const decisionMethodEnum = pgEnum('decision_method', ['NORMAL', 'EXTRA_TIME', 'PENALTIES']);

/** Section 14/25 — graphic categories, one renderer per type. */
export const graphicTypeEnum = pgEnum('graphic_type', [
  'GROUP_FIXTURES',
  'GROUP_STANDINGS',
  'KNOCKOUT_BRACKET',
  'WINNER_ANNOUNCEMENT',
]);

/** Section 18/24 — how a fixture ultimately got resolved, for audit clarity. */
export const resolutionSourceEnum = pgEnum('resolution_source', [
  'DUAL_SUBMISSION',
  'STAFF_OVERRIDE',
  'FORFEIT_HOME',
  'FORFEIT_AWAY',
  'VOID',
]);

/** Section 15 — per-team group confirmation state. */
export const confirmationStatusEnum = pgEnum('confirmation_status', [
  'PENDING',
  'CONFIRMED',
  'INACTIVE_PENDING_REPLACEMENT',
  'FORCE_CONFIRMED',
]);

/** Section 11/23/25 — every stage a fixture or knockout round can belong to. */
export const stageEnum = pgEnum('stage', [
  'GROUP',
  'ROUND_OF_64',
  'ROUND_OF_32',
  'ROUND_OF_16',
  'QUARTER_FINAL',
  'SEMI_FINAL',
  'FINAL',
]);

export const knockoutRoundStatusEnum = pgEnum('knockout_round_status', [
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'PAUSED',
]);

/** Section 9 — external payment rail; the bot never touches money itself. */
export const paymentMethodEnum = pgEnum('payment_method', ['PAYPAL', 'REVOLUT']);

// ── Convenience type aliases (avoid `(typeof xEnum.enumValues)[number]` at every call site) ──
export type TournamentStatus = (typeof tournamentStatusEnum.enumValues)[number];
export type EntryStatus = (typeof entryStatusEnum.enumValues)[number];
export type FixtureStatus = (typeof fixtureStatusEnum.enumValues)[number];
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number];
export type ActorType = (typeof actorTypeEnum.enumValues)[number];
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
export type JobType = (typeof jobTypeEnum.enumValues)[number];
export type DecisionMethod = (typeof decisionMethodEnum.enumValues)[number];
export type GraphicType = (typeof graphicTypeEnum.enumValues)[number];
export type ResolutionSource = (typeof resolutionSourceEnum.enumValues)[number];
export type ConfirmationStatus = (typeof confirmationStatusEnum.enumValues)[number];
export type Stage = (typeof stageEnum.enumValues)[number];
export type KnockoutRoundStatus = (typeof knockoutRoundStatusEnum.enumValues)[number];
export type PaymentMethod = (typeof paymentMethodEnum.enumValues)[number];
