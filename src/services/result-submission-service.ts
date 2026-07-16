import type { Database } from '../database/client.js';
import type { Fixture } from '../database/schema/index.js';
import { getGroupById, updateGroupResources } from '../database/repositories/group-repository.js';
import { getKnockoutRoundById, updateKnockoutRoundResources } from '../database/repositories/knockout-round-repository.js';
import { getFixturesByGroup, getFixturesByKnockoutRound, getFixtureById, resolveFixtureResult, updateFixtureStatus } from '../database/repositories/fixture-repository.js';
import {
  createResultSubmission,
  getActiveSubmissionForEntry,
  getActiveSubmissionsForFixture,
  deactivateSubmission,
} from '../database/repositories/result-submission-repository.js';
import { normalizeSubmission, submissionsMatch, type RawSubmission, type CanonicalResult } from '../domain/fixtures/result-matching.js';
import { validateKnockoutResult } from '../domain/fixtures/result-validation.js';
import { assertFixtureTransition } from '../domain/fixtures/state-machine.js';
import { STAGE_LABELS } from '../domain/knockouts/knockout-draw.js';
import { ValidationError, PermissionError } from '../types/errors.js';

export interface FixtureParentContext {
  resultsChannelId: string | null;
  staffChannelId: string | null;
  chatChannelId: string | null;
  resultsPanelMessageId: string | null;
  label: string;
  getAllFixtures(db: Database): Promise<Fixture[]>;
  setResultsPanelMessageId(db: Database, messageId: string): Promise<void>;
}

/** Fixtures belong to exactly one of a group or a knockout round (never
 * both) — this abstracts over which, so the submission flow doesn't need
 * to care which stage a fixture is in. */
export async function getFixtureParentContext(db: Database, fixture: Fixture): Promise<FixtureParentContext> {
  if (fixture.groupId) {
    const group = await getGroupById(db, fixture.groupId);
    if (!group) throw new Error(`Group ${fixture.groupId} not found`);
    return {
      resultsChannelId: group.resultsChannelId,
      staffChannelId: group.staffChannelId,
      chatChannelId: group.chatChannelId,
      resultsPanelMessageId: group.resultsPanelMessageId,
      label: `Group ${group.groupCode}`,
      getAllFixtures: (db2) => getFixturesByGroup(db2, group.id),
      setResultsPanelMessageId: async (db2, messageId) => {
        await updateGroupResources(db2, group.id, { resultsPanelMessageId: messageId });
      },
    };
  }
  if (fixture.knockoutRoundId) {
    const round = await getKnockoutRoundById(db, fixture.knockoutRoundId);
    if (!round) throw new Error(`Knockout round ${fixture.knockoutRoundId} not found`);
    return {
      resultsChannelId: round.resultsChannelId,
      staffChannelId: round.staffChannelId,
      chatChannelId: round.chatChannelId,
      resultsPanelMessageId: round.resultsPanelMessageId,
      label: STAGE_LABELS[round.stage],
      getAllFixtures: (db2) => getFixturesByKnockoutRound(db2, round.id),
      setResultsPanelMessageId: async (db2, messageId) => {
        await updateKnockoutRoundResources(db2, round.id, { resultsPanelMessageId: messageId });
      },
    };
  }
  throw new Error(`Fixture ${fixture.id} has neither groupId nor knockoutRoundId`);
}

const MANAGER_SUBMITTABLE_STATUSES = ['WAITING_FOR_SUBMISSIONS', 'WAITING_FOR_OPPONENT', 'RESULT_CONFLICT'] as const;
const STAFF_OVERRIDABLE_STATUSES = ['WAITING_FOR_SUBMISSIONS', 'WAITING_FOR_OPPONENT', 'RESULT_CONFLICT', 'READY', 'SCHEDULED'] as const;

export function isManagerSubmittable(status: Fixture['status']): boolean {
  return (MANAGER_SUBMITTABLE_STATUSES as readonly string[]).includes(status);
}

export function isStaffOverridable(status: Fixture['status']): boolean {
  return (STAFF_OVERRIDABLE_STATUSES as readonly string[]).includes(status);
}

/** Which of a fixture's two entries a Discord user is authorized to submit
 * for — the manager or co-manager of either side. Throws PermissionError
 * if neither matches (callers should check staff membership themselves
 * before falling back to this — staff aren't tied to either side). */
export function resolveSubmittingEntryId(fixture: Fixture, homeManagerIds: string[], awayManagerIds: string[], userId: string): string {
  if (homeManagerIds.includes(userId)) return fixture.homeEntryId;
  if (awayManagerIds.includes(userId)) return fixture.awayEntryId;
  throw new PermissionError('You are not the manager or co-manager of either team in this fixture.');
}

export type SubmissionOutcome =
  | { type: 'waiting_for_opponent' }
  | { type: 'resolved'; canonical: CanonicalResult; resolutionSource: 'DUAL_SUBMISSION' | 'STAFF_OVERRIDE' }
  | { type: 'conflict'; mine: CanonicalResult; theirs: CanonicalResult };

/**
 * Section 18's dual-sided submission core: normalizes a raw submission,
 * validates it (knockout-only rules), stores it, and either waits for the
 * opponent, silently auto-resolves (matching submissions), or flags
 * RESULT_CONFLICT for staff. A manager can resubmit — their previous
 * active submission is deactivated (kept for audit history, not deleted)
 * and superseded by the new one, which re-runs the same match/conflict
 * check against whatever the opponent has on file.
 */
export async function processManagerSubmission(
  db: Database,
  fixture: Fixture,
  submittingEntryId: string,
  submittingUserId: string,
  raw: RawSubmission,
): Promise<SubmissionOutcome> {
  if (!isManagerSubmittable(fixture.status)) {
    throw new ValidationError(`This fixture isn't accepting submissions right now (status: ${fixture.status.replace(/_/g, ' ')}).`);
  }

  const canonical = normalizeSubmission(raw, fixture.homeEntryId, fixture.awayEntryId);
  if (fixture.stage !== 'GROUP') {
    validateKnockoutResult(canonical, fixture.homeEntryId, fixture.awayEntryId);
  } else if (canonical.decisionMethod === 'PENALTIES') {
    throw new ValidationError('Group matches are never decided on penalties — a draw is a valid group result.');
  }

  const existing = await getActiveSubmissionForEntry(db, fixture.id, submittingEntryId);
  if (existing) await deactivateSubmission(db, existing.id);

  await createResultSubmission(db, {
    fixtureId: fixture.id,
    submittingEntryId,
    submittingUserId,
    canonicalHomeScore: canonical.homeScore,
    canonicalAwayScore: canonical.awayScore,
    decisionMethod: canonical.decisionMethod,
    penaltyHome: canonical.penaltyHome,
    penaltyAway: canonical.penaltyAway,
    declaredWinnerEntryId: canonical.winnerEntryId,
    revision: (existing?.revision ?? 0) + 1,
  });

  const opponentEntryId = submittingEntryId === fixture.homeEntryId ? fixture.awayEntryId : fixture.homeEntryId;
  const opponentSubmission = await getActiveSubmissionForEntry(db, fixture.id, opponentEntryId);

  if (!opponentSubmission) {
    if (fixture.status === 'WAITING_FOR_SUBMISSIONS') {
      assertFixtureTransition(fixture.status, 'WAITING_FOR_OPPONENT');
      await updateFixtureStatus(db, fixture.id, fixture.version, 'WAITING_FOR_OPPONENT');
    }
    return { type: 'waiting_for_opponent' };
  }

  const theirs: CanonicalResult = {
    homeScore: opponentSubmission.canonicalHomeScore,
    awayScore: opponentSubmission.canonicalAwayScore,
    decisionMethod: opponentSubmission.decisionMethod,
    penaltyHome: opponentSubmission.penaltyHome,
    penaltyAway: opponentSubmission.penaltyAway,
    winnerEntryId: opponentSubmission.declaredWinnerEntryId,
  };

  const fresh = await getFixtureById(db, fixture.id);
  if (!fresh) throw new Error(`Fixture ${fixture.id} disappeared mid-submission.`);

  if (submissionsMatch(canonical, theirs)) {
    assertFixtureTransition(fresh.status, 'RESOLVED');
    await resolveFixtureResult(db, fresh.id, fresh.version, {
      homeScore: canonical.homeScore,
      awayScore: canonical.awayScore,
      winnerEntryId: canonical.winnerEntryId,
      decisionMethod: canonical.decisionMethod ?? 'NORMAL',
      resolutionSource: 'DUAL_SUBMISSION',
    });
    return { type: 'resolved', canonical, resolutionSource: 'DUAL_SUBMISSION' };
  }

  if (fresh.status !== 'RESULT_CONFLICT') {
    assertFixtureTransition(fresh.status, 'RESULT_CONFLICT');
    await updateFixtureStatus(db, fresh.id, fresh.version, 'RESULT_CONFLICT');
  }
  return { type: 'conflict', mine: canonical, theirs };
}

/** Staff input is already home/away-oriented (not "my side"), and is
 * authoritative — no matching against an opponent submission, resolves
 * immediately. Reuses normalizeSubmission by treating the home entry as
 * the "submitter" so its side-orientation logic falls out for free. */
export async function processStaffOverride(
  db: Database,
  fixture: Fixture,
  raw: { homeScore: number; awayScore: number; decisionMethod?: RawSubmission['decisionMethod']; penaltyHome?: number; penaltyAway?: number },
): Promise<SubmissionOutcome> {
  if (!isStaffOverridable(fixture.status)) {
    throw new ValidationError(`This fixture can't be overridden right now (status: ${fixture.status.replace(/_/g, ' ')}).`);
  }

  const submission: RawSubmission = {
    submittingEntryId: fixture.homeEntryId,
    scoreForSubmitter: raw.homeScore,
    scoreForOpponent: raw.awayScore,
    ...(raw.decisionMethod !== undefined && { decisionMethod: raw.decisionMethod }),
    ...(raw.penaltyHome !== undefined && { penaltyForSubmitter: raw.penaltyHome }),
    ...(raw.penaltyAway !== undefined && { penaltyForOpponent: raw.penaltyAway }),
  };
  const canonical = normalizeSubmission(submission, fixture.homeEntryId, fixture.awayEntryId);
  if (fixture.stage !== 'GROUP') {
    validateKnockoutResult(canonical, fixture.homeEntryId, fixture.awayEntryId);
  }

  assertFixtureTransition(fixture.status, 'RESOLVED');
  await resolveFixtureResult(db, fixture.id, fixture.version, {
    homeScore: canonical.homeScore,
    awayScore: canonical.awayScore,
    winnerEntryId: canonical.winnerEntryId,
    decisionMethod: canonical.decisionMethod ?? 'NORMAL',
    resolutionSource: 'STAFF_OVERRIDE',
  });

  return { type: 'resolved', canonical, resolutionSource: 'STAFF_OVERRIDE' };
}

/** Both currently-active submissions for a fixture, if any — used by the
 * conflict panel to show staff exactly what each side reported. */
export async function getFixtureSubmissions(db: Database, fixtureId: string) {
  return getActiveSubmissionsForFixture(db, fixtureId);
}
