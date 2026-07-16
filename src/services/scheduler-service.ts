import type { Database } from '../database/client.js';
import type { Logger } from '../utils/logger.js';
import {
  claimDueJobs,
  completeJob,
  failJob,
  reconcileOverdueJobs,
  enqueueJob,
} from '../database/repositories/job-repository.js';
import type { ScheduledJob, NewScheduledJob } from '../database/schema/index.js';
import type { JobType } from '../database/schema/enums.js';

export type JobHandler = (job: ScheduledJob) => Promise<void>;

/**
 * Database-backed scheduler engine (section 32). This class owns the
 * claim -> run -> complete/retry loop; it knows nothing about what a
 * PAYMENT_DEADLINE or MIDNIGHT_CLEANUP job actually DOES — handlers are
 * registered per job_type via registerHandler() and dispatched here. This
 * separation lets the claiming/retry/reconciliation logic (the safety-
 * critical, hardest-to-get-right part) be tested completely independently
 * of any specific business operation.
 */
export class SchedulerService {
  private readonly handlers = new Map<JobType, JobHandler>();
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly db: Database,
    private readonly logger: Logger,
    private readonly workerId: string,
    private readonly pollIntervalMs = 5000,
    private readonly batchSize = 10,
  ) {}

  registerHandler(jobType: JobType, handler: JobHandler): void {
    this.handlers.set(jobType, handler);
  }

  async enqueue(job: NewScheduledJob): Promise<void> {
    const inserted = await enqueueJob(this.db, job);
    if (inserted) {
      this.logger.info({ jobId: inserted.id, jobType: inserted.jobType, runAt: inserted.runAt }, 'Job enqueued');
    } else {
      this.logger.debug({ idempotencyKey: job.idempotencyKey }, 'Job already enqueued — skipped (idempotency)');
    }
  }

  /** Call once at startup, before the poll loop begins. */
  async reconcileOnStartup(): Promise<void> {
    const reconciled = await reconcileOverdueJobs(this.db);
    if (reconciled > 0) {
      this.logger.warn({ reconciled }, 'Reconciled jobs stuck in RUNNING from a crashed worker');
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollIntervalMs);
    this.logger.info({ workerId: this.workerId, pollIntervalMs: this.pollIntervalMs }, 'Scheduler started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.running) return; // don't overlap ticks if a batch runs long
    this.running = true;
    try {
      const jobs = await claimDueJobs(this.db, this.workerId, this.batchSize);
      for (const job of jobs) {
        await this.runJob(job);
      }
    } catch (error) {
      this.logger.error({ error }, 'Scheduler tick failed');
    } finally {
      this.running = false;
    }
  }

  private async runJob(job: ScheduledJob): Promise<void> {
    const handler = this.handlers.get(job.jobType);
    const jobLogger = this.logger.child({ jobId: job.id, jobType: job.jobType, attempts: job.attempts });

    if (!handler) {
      jobLogger.error('No handler registered for this job type — marking as failed');
      await failJob(this.db, job, `No handler registered for job type ${job.jobType}`);
      return;
    }

    const startedAt = Date.now();
    try {
      await handler(job);
      await completeJob(this.db, job.id);
      jobLogger.info({ durationMs: Date.now() - startedAt }, 'Job completed');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const outcome = await failJob(this.db, job, message);
      if (outcome === 'DEAD_LETTER') {
        jobLogger.error({ error, durationMs: Date.now() - startedAt }, 'Job permanently failed (dead letter) — staff attention needed');
      } else {
        jobLogger.warn({ error, durationMs: Date.now() - startedAt }, 'Job failed, will retry with backoff');
      }
    }
  }
}
