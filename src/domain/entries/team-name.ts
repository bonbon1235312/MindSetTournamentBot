import { ValidationError } from '../../types/errors.js';
import { TEAM_NAME_MAX_LENGTH } from '../../config/constants.js';

/** Discord mass-mention / abuse patterns a team name must never contain
 * (section 7). Also strips zero-width characters commonly used to dodge
 * naive filters. */
const MASS_MENTION_PATTERN = /@(everyone|here)|<@[!&]?\d+>|<#\d+>/;
const ZERO_WIDTH_PATTERN = /[​-‍﻿]/g;

export interface ValidatedTeamName {
  /** The exact spelling to display, whitespace-trimmed only. */
  displayName: string;
  /** Lowercased, whitespace-collapsed form used for uniqueness checks. */
  normalisedName: string;
}

/**
 * Validates and normalises a team name (section 7). Throws ValidationError
 * with a user-facing message on any violation; callers should let that
 * propagate to the interaction error boundary rather than catching it.
 */
export function validateTeamName(raw: string): ValidatedTeamName {
  const withoutZeroWidth = raw.replace(ZERO_WIDTH_PATTERN, '');
  const displayName = withoutZeroWidth.trim();

  if (displayName.length === 0) {
    throw new ValidationError('Team name cannot be empty.');
  }
  if (displayName.length > TEAM_NAME_MAX_LENGTH) {
    throw new ValidationError(`Team name must be ${TEAM_NAME_MAX_LENGTH} characters or fewer.`);
  }
  if (MASS_MENTION_PATTERN.test(displayName)) {
    throw new ValidationError('Team name cannot contain @everyone, @here, or Discord mentions.');
  }

  const normalisedName = displayName.toLowerCase().replace(/\s+/g, ' ');

  return { displayName, normalisedName };
}
