/**
 * Typed application errors (section 38). Every one carries a user-facing
 * `message` safe to show directly in an ephemeral Discord reply, plus a
 * machine-readable `code` for logging/metrics. Never let a raw Error,
 * database exception, or Discord API error reach the user — catch it at
 * the interaction boundary and translate or wrap it in one of these.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  /** true if this is safe to show verbatim to the Discord user. */
  readonly userFacing: boolean = true;

  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  readonly code = 'VALIDATION_ERROR';
  constructor(message: string) {
    super(message);
  }
}

export class NotFoundError extends AppError {
  readonly code = 'NOT_FOUND';
  constructor(entity: string) {
    super(`${entity} could not be found.`);
  }
}

export class PermissionError extends AppError {
  readonly code = 'PERMISSION_DENIED';
  constructor(message = 'You do not have permission to do that.') {
    super(message);
  }
}

export class AlreadyRegisteredError extends AppError {
  readonly code = 'ALREADY_REGISTERED';
  constructor() {
    super('You are already registered with another team in this tournament.');
  }
}

export class SignupClosedError extends AppError {
  readonly code = 'SIGNUP_CLOSED';
  constructor() {
    super('This tournament is no longer accepting signups.');
  }
}

export class TournamentAlreadyActiveError extends AppError {
  readonly code = 'TOURNAMENT_ALREADY_ACTIVE';
  constructor(activeTournamentName: string) {
    super(`Only one cup runs at a time, and **${activeTournamentName}** is still in progress. Finish or cancel it first.`);
  }
}

export class PaymentNotConfirmedError extends AppError {
  readonly code = 'PAYMENT_NOT_CONFIRMED';
  constructor() {
    super('Your team has not been payment-confirmed.');
  }
}

export class NotTeamOfficialError extends AppError {
  readonly code = 'NOT_TEAM_OFFICIAL';
  constructor() {
    super('You are not the manager or co-manager for this team.');
  }
}

export class FixtureAlreadyResolvedError extends AppError {
  readonly code = 'FIXTURE_RESOLVED';
  constructor() {
    super('This fixture has already been resolved.');
  }
}

export class StalePanelError extends AppError {
  readonly code = 'STALE_PANEL';
  constructor() {
    super('This panel is out of date. Press Refresh.');
  }
}

export class NicknameRoleHierarchyError extends AppError {
  readonly code = 'NICKNAME_ROLE_HIERARCHY';
  constructor() {
    super("The bot can't rename you because its role is below yours — ask staff to fix this.");
  }
}

export class NoReservesAvailableError extends AppError {
  readonly code = 'NO_RESERVES_AVAILABLE';
  constructor() {
    super('No reserve teams are currently available.');
  }
}

export class DuplicateTeamNameError extends AppError {
  readonly code = 'DUPLICATE_TEAM_NAME';
  constructor() {
    super('That team name is already taken in this tournament. Pick another.');
  }
}

export class BannedError extends AppError {
  readonly code = 'BANNED';
  constructor(reason: string) {
    super(`You are tournament-banned and cannot sign up. Reason: ${reason}`);
  }
}

export class InvalidStateTransitionError extends AppError {
  readonly code = 'INVALID_STATE_TRANSITION';
  constructor(entity: string, from: string, to: string) {
    super(`Cannot move ${entity} from ${from} to ${to}.`);
  }
}

export class MissingConfigurationError extends AppError {
  readonly code = 'MISSING_CONFIGURATION';
  constructor(missing: string[]) {
    super(`This server is missing required setup: ${missing.join(', ')}. Run /setup first.`);
  }
}

/** Wraps an unknown/internal error for logging without leaking internals to
 * the user. `cause` is logged, never shown. */
export class InternalError extends AppError {
  readonly code = 'INTERNAL_ERROR';
  override readonly userFacing = false;
  readonly internalCause?: unknown;
  constructor(message: string, internalCause?: unknown) {
    super(message);
    this.internalCause = internalCause;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Converts any thrown value into a safe, user-facing message. */
export function toUserMessage(error: unknown): string {
  if (isAppError(error)) {
    return error.userFacing ? error.message : 'Something went wrong. Staff have been notified.';
  }
  return 'Something went wrong. Staff have been notified.';
}
