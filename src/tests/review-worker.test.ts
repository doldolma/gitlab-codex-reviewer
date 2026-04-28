import { describe, expect, it, vi } from "vitest";
import { ReviewWorker } from "../worker/review-worker";
import { testConfig } from "./test-utils";

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
    expect(state.requeueReviewJob).toHaveBeenCalledWith(99, "Project review or release note job is already running.");
    expect(state.addReviewEvent).toHaveBeenCalledWith(expect.objectContaining({
      runType: "release_note",
      runId: 22,
      step: "job_deferred"
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
