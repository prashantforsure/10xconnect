import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { ImportService } from "./import.service";

const TICK_MS = 60_000;

/**
 * In-process poller for continuous / auto-refresh imports (CLAUDE.md §8). Once a
 * minute it asks ImportService to run every due "live import" source, which
 * re-checks the LinkedIn source and imports only NEW leads (workspace dedupe).
 *
 * This mirrors the import-queue's Phase-4 seam: when Redis/BullMQ land, swap this
 * for a repeatable queue job WITHOUT touching ImportService.runDueSources. Kept
 * dependency-free (no @nestjs/schedule) so it's mock-safe in local dev.
 */
@Injectable()
export class ContinuousImportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("ContinuousImport");
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private readonly imports: ImportService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Don't keep the process alive just for the poller.
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
    this.logger.log("Continuous import poller started (60s interval).");
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return; // never overlap ticks
    }
    this.running = true;
    try {
      const ran = await this.imports.runDueSources();
      if (ran > 0) {
        this.logger.log(`Ran ${ran} due live import(s).`);
      }
    } catch (err) {
      this.logger.error(`Continuous import tick failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
