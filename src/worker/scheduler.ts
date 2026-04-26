import type { AppConfig } from "../lib/config";
import { logWorker } from "../lib/logger";
import type { ReviewWorker } from "./review-worker";

export class ReviewScheduler {
  private stopped = true;
  private sleepTimer: NodeJS.Timeout | null = null;
  private nextScanAt = 0;

  constructor(
    private readonly config: AppConfig,
    private readonly worker: ReviewWorker
  ) {}

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.loop();
  }

  stop(): void {
    this.stopped = true;
    if (this.sleepTimer) clearTimeout(this.sleepTimer);
    this.sleepTimer = null;
  }

  private async loop(): Promise<void> {
    this.nextScanAt = 0;
    while (!this.stopped) {
      try {
        await this.worker.processQueuedJobs(this.config.reviewConcurrency);
        if (Date.now() >= this.nextScanAt) {
          await this.worker.scanOnce();
          this.nextScanAt = Date.now() + this.config.pollIntervalSeconds * 1000;
        }
      } catch (error) {
        logWorker("error", "Background worker loop failed.", { error: error instanceof Error ? error.message : String(error) });
      }
      if (this.stopped) break;
      await this.sleep(1000);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepTimer = setTimeout(() => {
        this.sleepTimer = null;
        resolve();
      }, ms);
    });
  }
}
