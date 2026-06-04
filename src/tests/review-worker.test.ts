import { describe, expect, it, vi } from "vitest";
import { ReviewWorker } from "../worker/review-worker";
import { testConfig } from "./test-utils";

describe("ReviewWorker job pool", () => {
  it("starts queued jobs up to the active slot limit and refills freed slots", async () => {
    const { worker, state } = workerWithQueue([poolJob(1, 101), poolJob(2, 102), poolJob(3, 103)]);
    const first = deferred<"processed">();
    const second = deferred<"processed">();
    const third = deferred<"processed">();
    const processor = vi.fn((job: { id: number }) => {
      if (job.id === 1) return first.promise;
      if (job.id === 2) return second.promise;
      return third.promise;
    });
    (worker as any).processClaimedJob = processor;

    const started = await worker.fillQueuedJobSlots(2);

    expect(started).toEqual({ started: 2, active: 2, recovered: 0 });
    expect(state.claimNextReviewJob).toHaveBeenCalledTimes(2);
    expect(processor).toHaveBeenCalledTimes(2);
    expect(worker.activeJobCount()).toBe(2);

    const saturated = await worker.fillQueuedJobSlots(2);
    expect(saturated.started).toBe(0);
    expect(state.claimNextReviewJob).toHaveBeenCalledTimes(2);

    first.resolve("processed");
    await flushPromises();
    expect(worker.activeJobCount()).toBe(1);

    const refilled = await worker.fillQueuedJobSlots(2);
    expect(refilled.started).toBe(1);
    expect(worker.activeJobCount()).toBe(2);
    expect(processor).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));

    second.resolve("processed");
    third.resolve("processed");
    await flushPromises();
    expect(worker.activeJobCount()).toBe(0);
  });

  it("skips queued jobs from projects that already have an active job", async () => {
    const { worker } = workerWithQueue([
      poolJob(1, 101),
      poolJob(2, 101),
      poolJob(3, 101),
      poolJob(4, 202)
    ]);
    const first = deferred<"processed">();
    const fourth = deferred<"processed">();
    const processor = vi.fn((job: { id: number }) => job.id === 1 ? first.promise : fourth.promise);
    (worker as any).processClaimedJob = processor;

    const started = await worker.fillQueuedJobSlots(2);

    expect(started.started).toBe(2);
    expect(processor).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(processor).toHaveBeenCalledWith(expect.objectContaining({ id: 4 }));
    expect(processor).not.toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
    expect(processor).not.toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));

    first.resolve("processed");
    fourth.resolve("processed");
    await flushPromises();
  });

  it("removes crashed jobs from the active pool", async () => {
    const { worker } = workerWithQueue([poolJob(1, 101)]);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = deferred<"processed">();
    (worker as any).processClaimedJob = vi.fn(() => failure.promise);

    await worker.fillQueuedJobSlots(1);
    expect(worker.activeJobCount()).toBe(1);

    failure.reject(new Error("boom"));
    await flushPromises();

    expect(worker.activeJobCount()).toBe(0);
    consoleError.mockRestore();
  });
});

describe("ReviewWorker project job prelude", () => {
  it("requeues shared-project jobs when the project lock is busy", async () => {
    const { worker, state } = workerWithState({ projectLockAvailable: false });
    const action = vi.fn();

    const result = await (worker as any).withProjectJobLock(
      releaseNoteJob(),
      10,
      { runType: "release_note", runId: 22, sha: "tag-sha" },
      undefined,
      action,
      "Project review or release note job is already running."
    );

    expect(result).toBe("deferred");
    expect(action).not.toHaveBeenCalled();
    expect(state.requeueReviewJob).toHaveBeenCalledWith(99, "Project review or release note job is already running.", 60_000);
    expect(state.addReviewEvent).toHaveBeenCalledWith(expect.objectContaining({
      runType: "release_note",
      runId: 22,
      step: "job_deferred"
    }));
  });

  it("fails busy jobs after too many project lock retries", async () => {
    const { worker, state } = workerWithState({ projectLockAvailable: false });

    await expect((worker as any).withProjectJobLock(
      { ...releaseNoteJob(), attempts: 45 },
      10,
      { runType: "release_note", runId: 22, sha: "tag-sha" },
      undefined,
      vi.fn(),
      "Project review or release note job is already running."
    )).rejects.toThrow("Maximum busy retry attempts exceeded");

    expect(state.requeueReviewJob).not.toHaveBeenCalled();
    expect(state.addReviewEvent).toHaveBeenCalledWith(expect.objectContaining({
      runType: "release_note",
      runId: 22,
      step: "job_busy_retry_exhausted",
      level: "error"
    }));
  });

  it("holds the project lock while release note task locks run", async () => {
    const { worker, state } = workerWithState({ projectLockAvailable: true });

    const result = await (worker as any).withProjectJobLock(
      releaseNoteJob(),
      10,
      { runType: "release_note", runId: 22, sha: "tag-sha" },
      undefined,
      async ({ sharedProject }: any) => {
        const releaseLock = `release-note:${sharedProject.id}:v1.2.0`;
        expect(await state.acquireLock(releaseLock)).toBe(true);
        await state.releaseLock(releaseLock);
        return "processed";
      }
    );

    expect(result).toBe("processed");
    expect(state.acquireLock.mock.calls.map(([key]) => key)).toEqual([
      "project:https://gitlab.example.com:123",
      "release-note:10:v1.2.0"
    ]);
    expect(state.releaseLock.mock.calls.map(([key]) => key)).toEqual([
      "release-note:10:v1.2.0",
      "project:https://gitlab.example.com:123"
    ]);
  });
});

function workerWithState({ projectLockAvailable }: { projectLockAvailable: boolean }) {
  const state = {
    getGitlabProject: vi.fn().mockResolvedValue({
      id: 10,
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service",
      webUrl: null,
      cloneHttpUrl: "https://gitlab.example.com/group/service.git",
      defaultBranch: "main",
      workspaceError: null,
      webhookHookId: null,
      webhookSecretEncrypted: null,
      webhookUrl: null,
      webhookLastVerifiedAt: null,
      webhookError: null,
      reviewStrategy: "auto",
      reviewStrategyUpdatedByUserId: null,
      reviewStrategyUpdatedAt: null,
      reviewProfile: "assertive",
      pathFilters: [],
      releaseNotesEnabled: true,
      releaseNotesContext: null,
      createdAt: "2026-04-28T00:00:00.000Z",
      updatedAt: "2026-04-28T00:00:00.000Z"
    }),
    acquireLock: vi.fn()
      .mockResolvedValueOnce(projectLockAvailable)
      .mockResolvedValue(true),
    releaseLock: vi.fn().mockResolvedValue(undefined),
    requeueReviewJob: vi.fn().mockResolvedValue(undefined),
    addReviewEvent: vi.fn().mockResolvedValue(undefined)
  };
  const reviewerBot = {
    getConnection: vi.fn().mockResolvedValue({
      userId: 0,
      gitlabHost: "https://gitlab.example.com",
      gitlabUserId: 100,
      username: "reviewer-bot",
      accessToken: "token",
      refreshToken: "",
      expiresAt: "9999-12-31T23:59:59.999Z",
      authType: "private-token"
    })
  };
  const worker = new ReviewWorker(testConfig(), {} as any, state as any, reviewerBot as any);
  return { worker, state };
}

function workerWithQueue(jobs: ReturnType<typeof poolJob>[]) {
  const queue = [...jobs];
  const state = {
    recoverStaleRunningJobs: vi.fn().mockResolvedValue(0),
    claimNextReviewJob: vi.fn(async (options?: { excludedGitlabProjectRefIds?: number[] }) => {
      const excluded = new Set(options?.excludedGitlabProjectRefIds ?? []);
      const index = queue.findIndex((job) => !excluded.has(Number(job.payload.gitlabProjectRefId)));
      if (index < 0) return null;
      const [job] = queue.splice(index, 1);
      return job ?? null;
    })
  };
  const worker = new ReviewWorker(testConfig(), {} as any, state as any, {} as any);
  return { worker, state };
}

function poolJob(id: number, gitlabProjectRefId: number) {
  return {
    id,
    kind: "commit_webhook",
    status: "running",
    userId: 1,
    runType: "commit",
    runId: id * 10,
    payload: { gitlabProjectRefId, gitlabProjectId: String(gitlabProjectRefId), commitSha: `sha-${id}` },
    attempts: 1,
    errorMessage: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    startedAt: "2026-04-28T00:00:00.000Z",
    finishedAt: null
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function releaseNoteJob() {
  return {
    id: 99,
    kind: "release_note_manual",
    status: "running",
    userId: 1,
    runType: null,
    runId: null,
    payload: { gitlabProjectId: "123", tagName: "v1.2.0" },
    attempts: 1,
    errorMessage: null,
    createdAt: "2026-04-28T00:00:00.000Z",
    updatedAt: "2026-04-28T00:00:00.000Z",
    startedAt: "2026-04-28T00:00:00.000Z",
    finishedAt: null
  };
}
