import { describe, expect, it, vi } from "vitest";
import { ReviewScheduler } from "../worker/scheduler";
import { testConfig } from "./test-utils";

describe("ReviewScheduler", () => {
  it("fills worker slots without running fallback scan while queue jobs are active", async () => {
    const worker = {
      fillQueuedJobSlots: vi.fn().mockResolvedValue({ started: 0, active: 1, recovered: 0 }),
      activeJobCount: vi.fn().mockReturnValue(1),
      scanOnce: vi.fn().mockResolvedValue({ reviewed: 0, skipped: 0, errors: 0 })
    };
    const scheduler = new ReviewScheduler(testConfig({ reviewConcurrency: 2 }), worker as any);

    scheduler.start();
    await flushPromises();
    scheduler.stop();

    expect(worker.fillQueuedJobSlots).toHaveBeenCalledWith(2);
    expect(worker.scanOnce).not.toHaveBeenCalled();
  });

  it("runs fallback scan when no queue jobs are active and the scan interval is due", async () => {
    const worker = {
      fillQueuedJobSlots: vi.fn().mockResolvedValue({ started: 0, active: 0, recovered: 0 }),
      activeJobCount: vi.fn().mockReturnValue(0),
      scanOnce: vi.fn().mockResolvedValue({ reviewed: 0, skipped: 0, errors: 0 })
    };
    const scheduler = new ReviewScheduler(testConfig({ reviewConcurrency: 2 }), worker as any);

    scheduler.start();
    await flushPromises();
    scheduler.stop();

    expect(worker.fillQueuedJobSlots).toHaveBeenCalledWith(2);
    expect(worker.scanOnce).toHaveBeenCalledTimes(1);
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
