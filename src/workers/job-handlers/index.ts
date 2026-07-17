import type { AppContext } from '../../types/context.js';
import { handlePremiumCutoff } from './premium-cutoff-handler.js';
import { handleSignupClose } from './signup-close-handler.js';
import { handleGroupPublish } from './group-publish-handler.js';
import { handleFixtureReady } from './fixture-ready-handler.js';
import { handleResultFirstReminder, handleResultStaffAlert } from './result-reminder-handler.js';
import { handleGroupConfirmationReminder, handleGroupConfirmationDeadline } from './group-confirmation-handler.js';
import { handlePrizeDetailsDeadline } from './prize-details-handler.js';
import { handleMidnightCleanup } from './midnight-cleanup-handler.js';

/** Wires every implemented job handler into the scheduler. */
export function registerJobHandlers(ctx: AppContext): void {
  ctx.scheduler.registerHandler('PREMIUM_CUTOFF', (job) => handlePremiumCutoff(job, ctx));
  ctx.scheduler.registerHandler('SIGNUP_CLOSE', (job) => handleSignupClose(job, ctx));
  ctx.scheduler.registerHandler('GROUP_PUBLISH', (job) => handleGroupPublish(job, ctx));
  ctx.scheduler.registerHandler('FIXTURE_READY', (job) => handleFixtureReady(job, ctx));
  ctx.scheduler.registerHandler('RESULT_FIRST_REMINDER', (job) => handleResultFirstReminder(job, ctx));
  ctx.scheduler.registerHandler('RESULT_STAFF_ALERT', (job) => handleResultStaffAlert(job, ctx));
  ctx.scheduler.registerHandler('GROUP_CONFIRMATION_REMINDER', (job) => handleGroupConfirmationReminder(job, ctx));
  ctx.scheduler.registerHandler('GROUP_CONFIRMATION_DEADLINE', (job) => handleGroupConfirmationDeadline(job, ctx));
  ctx.scheduler.registerHandler('PRIZE_DETAILS_DEADLINE', (job) => handlePrizeDetailsDeadline(job, ctx));
  ctx.scheduler.registerHandler('MIDNIGHT_CLEANUP', (job) => handleMidnightCleanup(job, ctx));
}
