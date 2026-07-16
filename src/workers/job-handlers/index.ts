import type { AppContext } from '../../types/context.js';
import { handlePremiumCutoff } from './premium-cutoff-handler.js';
import { handleSignupClose } from './signup-close-handler.js';
import { handleGroupPublish } from './group-publish-handler.js';

/**
 * Wires every implemented job handler into the scheduler. Job types listed
 * in the schema enum but not registered here (GROUP_CONFIRMATION_REMINDER,
 * GROUP_CONFIRMATION_DEADLINE, FIXTURE_READY, RESULT_FIRST_REMINDER,
 * RESULT_STAFF_ALERT, PRIZE_DETAILS_DEADLINE, MIDNIGHT_CLEANUP) will fail
 * with "No handler registered" if ever enqueued — see PLAN.md's known gaps.
 */
export function registerJobHandlers(ctx: AppContext): void {
  ctx.scheduler.registerHandler('PREMIUM_CUTOFF', (job) => handlePremiumCutoff(job, ctx));
  ctx.scheduler.registerHandler('SIGNUP_CLOSE', (job) => handleSignupClose(job, ctx));
  ctx.scheduler.registerHandler('GROUP_PUBLISH', (job) => handleGroupPublish(job, ctx));
}
