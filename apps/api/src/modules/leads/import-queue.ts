import { env } from "@10xconnect/config";
import { Injectable, Logger, type Provider } from "@nestjs/common";

/** DI token for the import-job queue. */
export const IMPORT_JOB_QUEUE = "IMPORT_JOB_QUEUE";

/**
 * The seam between "an import was requested" and "the import runs". Kept tiny and
 * execution-agnostic so the engine (source handlers, dedupe, persist, enrich) is
 * identical regardless of HOW the job is driven.
 *
 * Phase 3 ships an in-process implementation (jobs run async in the API process,
 * status tracked in import_jobs). Phase 4 — when Redis/BullMQ land per the
 * roadmap — swaps in a BullMQ-backed queue (see BullmqImportJobQueue below)
 * WITHOUT touching any source handler.
 */
export interface ImportJobQueue {
  /** Schedule `run` to execute asynchronously (must not block the caller). */
  enqueue(jobId: string, run: () => Promise<void>): void;
}

/**
 * Runs each import on the next tick, in-process, non-blocking. The HTTP request
 * returns immediately with a pending job; status/counts update as it runs.
 */
@Injectable()
export class InProcessImportJobQueue implements ImportJobQueue {
  private readonly logger = new Logger("ImportJobQueue");

  enqueue(jobId: string, run: () => Promise<void>): void {
    setImmediate(() => {
      run().catch((err) => {
        // The runner is responsible for marking the job failed; this is a
        // last-resort guard so an unhandled rejection never crashes the process.
        this.logger.error(`Import job ${jobId} crashed: ${String(err)}`);
      });
    });
  }
}

/**
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ STUB — Phase 4 (orchestration brain). Not wired yet.                       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * When Redis/BullMQ are introduced (roadmap Step 16+), this enqueues the jobId +
 * serialized request to a BullMQ queue; the worker (apps/worker) reconstructs the
 * runner from the persisted import_jobs row and executes it there, so imports
 * survive API restarts and scale horizontally. Intentionally unused until then.
 */
export class BullmqImportJobQueue implements ImportJobQueue {
  enqueue(_jobId: string, _run: () => Promise<void>): void {
    throw new Error("BullmqImportJobQueue is not implemented yet (Phase 4).");
  }
}

/** Provider: in-process today; logs a hint if REDIS_URL is set (Phase 4 swap). */
export const importJobQueueProvider: Provider = {
  provide: IMPORT_JOB_QUEUE,
  useFactory: (): ImportJobQueue => {
    if (env.REDIS_URL) {
      new Logger("ImportJobQueue").log(
        "REDIS_URL is set, but BullMQ-backed imports arrive in Phase 4; using the in-process queue for now.",
      );
    }
    return new InProcessImportJobQueue();
  },
};
