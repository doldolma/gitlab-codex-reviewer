import { describe, expect, it } from "vitest";
import { ReviewStateStore } from "../lib/review-state";
import { insertTestUser, testDb } from "./test-utils";

describe("multi-user review state", () => {
  it("allows different users to register the same GitLab project independently", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userA = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const userB = await insertTestUser(db, { gitlabUserId: 2, username: "bob" });

    const projectA = await state.createProject(userA, {
      gitlabProjectId: "group/service",
      displayName: "Alice service",
      enabled: true,
      skipLabels: ["skip-a"]
    });
    const projectB = await state.createProject(userB, {
      gitlabProjectId: "group/service",
      displayName: "Bob service",
      enabled: true,
      skipLabels: ["skip-b"]
    });

    expect(projectA.gitlabProjectId).toBe(projectB.gitlabProjectId);
    expect(await state.listProjects(userA)).toHaveLength(1);
    expect(await state.listProjects(userB)).toHaveLength(1);
    expect((await state.listProjects(userA))[0]?.skipLabels).toEqual(["skip-a"]);
    expect((await state.listProjects(userB))[0]?.skipLabels).toEqual(["skip-b"]);
    await db.$disconnect();
  });

  it("rejects duplicate GitLab projects for the same user", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const input = {
      gitlabProjectId: "group/service",
      displayName: "Service",
      enabled: true,
      skipLabels: []
    };

    await state.createProject(userId, input);

    await expect(state.createProject(userId, input)).rejects.toThrow();
    await db.$disconnect();
  });

  it("stores MR target branches and commit review branches per project", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });

    const project = await state.createProject(userId, {
      gitlabProjectId: "group/service",
      displayName: "Service",
      enabled: true,
      skipLabels: ["skip-codex-review"],
      mrTargetBranches: ["main", "develop"],
      commitBranches: ["main"]
    });

    expect(project.mrTargetBranches).toEqual(["main", "develop"]);
    expect(project.commitBranches).toEqual(["main"]);

    const updated = await state.updateProject(userId, project.id, {
      displayName: "Service",
      enabled: false,
      skipLabels: [],
      mrTargetBranches: [],
      commitBranches: ["release/1.0"]
    });

    expect(updated.enabled).toBe(false);
    expect(updated.mrTargetBranches).toEqual([]);
    expect(updated.commitBranches).toEqual(["release/1.0"]);
    await db.$disconnect();
  });

  it("groups duplicate user subscriptions into one shared project scan target", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userA = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const userB = await insertTestUser(db, { gitlabUserId: 2, username: "bob" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service"
    });

    await state.createProject(userA, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Alice service",
      enabled: true,
      skipLabels: ["skip-a"],
      mrTargetBranches: ["main"],
      commitBranches: ["main"]
    });
    await state.createProject(userB, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Bob service",
      enabled: true,
      skipLabels: ["skip-b"],
      mrTargetBranches: ["develop"],
      commitBranches: ["release/1.0"]
    });

    const groups = await state.listSharedProjectGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0]?.subscriptions).toHaveLength(2);
    expect(groups[0]?.skipLabels.sort()).toEqual(["skip-a", "skip-b"]);
    expect(groups[0]?.mrTargetBranches.sort()).toEqual(["develop", "main"]);
    expect(groups[0]?.commitBranches.sort()).toEqual(["main", "release/1.0"]);
    await db.$disconnect();
  });

  it("keeps merge request and review views scoped by user", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userA = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const userB = await insertTestUser(db, { gitlabUserId: 2, username: "bob" });
    const projectA = await state.createProject(userA, {
      gitlabProjectId: "group/service-a",
      displayName: "Alice service",
      enabled: true,
      skipLabels: []
    });
    await state.createProject(userB, {
      gitlabProjectId: "group/service-b",
      displayName: "Bob service",
      enabled: true,
      skipLabels: []
    });

    await state.upsertMergeRequest(projectA.id, {
      iid: 7,
      title: "Scoped MR",
      web_url: "https://gitlab.example.com/group/service-a/-/merge_requests/7",
      sha: "abc123",
      labels: [],
      draft: false,
      state: "opened",
      updated_at: new Date().toISOString()
    });

    expect(await state.listMergeRequestViews(userA)).toHaveLength(1);
    expect(await state.listMergeRequestViews(userB)).toHaveLength(0);
    await db.$disconnect();
  });

  it("keeps branch watch states and commit review runs scoped by user", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userA = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const userB = await insertTestUser(db, { gitlabUserId: 2, username: "bob" });
    const projectA = await state.createProject(userA, {
      gitlabProjectId: "group/service",
      displayName: "Alice service",
      enabled: true,
      skipLabels: [],
      commitBranches: ["main"]
    });
    const projectB = await state.createProject(userB, {
      gitlabProjectId: "group/service",
      displayName: "Bob service",
      enabled: true,
      skipLabels: [],
      commitBranches: ["main"]
    });

    await state.setBranchWatchState(projectA.id, "main", "base-sha", null);
    expect((await state.getBranchWatchState(projectA.id, "main"))?.lastSeenSha).toBe("base-sha");
    expect(await state.getBranchWatchState(projectB.id, "main")).toBeNull();

    const commit = {
      id: "abc123",
      title: "Fix bug",
      web_url: "https://gitlab.example.com/group/service/-/commit/abc123",
      author_name: "Alice",
      committed_date: new Date().toISOString()
    };
    const runId = await state.startCommitRun(userA, projectA.id, projectA.gitlabProjectId, "main", commit, "auto");
    await state.finishCommitNoFindings(runId);

    expect(await state.hasCompletedCommitRun(userA, projectA.gitlabProjectId, "abc123")).toBe(true);
    expect(await state.hasCompletedCommitRun(userB, projectB.gitlabProjectId, "abc123")).toBe(false);
    expect(await state.listCommitReviewRuns(userA)).toHaveLength(1);
    expect(await state.listCommitReviewRuns(userB)).toHaveLength(0);
    await db.$disconnect();
  });

  it("stores manual commit reviews even when the project is not watched", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });

    const runId = await state.startCommitRun(
      userId,
      null,
      "group/manual-only",
      null,
      { id: "def456", title: "Manual test" },
      "manual"
    );
    await state.failCommitRun(runId, new Error("review failed"));

    const runs = await state.listCommitReviewRuns(userId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.projectName).toBe("group/manual-only");
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.reviewMeta).toBeNull();
    await db.$disconnect();
  });

  it("adds Codex model and token usage metadata to commit review lists", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const runId = await state.startCommitRun(userId, null, "group/manual-only", "main", { id: "def456", title: "Manual test" }, "manual");

    await state.addReviewEvent({
      runType: "commit",
      runId,
      level: "info",
      step: "codex_started",
      message: "Codex review started.",
      metadata: { model: "gpt-5.5", modelReasoningEffort: "xhigh", promptVersion: "ko-workspace-review-v3" }
    });
    await state.addReviewEvent({
      runType: "commit",
      runId,
      level: "info",
      step: "codex_usage",
      message: "Codex turn usage recorded.",
      metadata: { inputTokens: 1200, outputTokens: 300, reasoningOutputTokens: 80, totalTokens: 1500 }
    });

    const runs = await state.listCommitReviewRuns(userId);
    expect(runs[0]?.reviewMeta).toEqual({
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      promptVersion: "ko-workspace-review-v3",
      inputTokens: 1200,
      outputTokens: 300,
      reasoningTokens: 80,
      totalTokens: 1500
    });
    await db.$disconnect();
  });

  it("adds Codex metadata to merge request lists and supports legacy token keys", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const project = await state.createProject(userId, {
      gitlabProjectId: "group/service",
      displayName: "Service",
      enabled: true,
      skipLabels: []
    });
    await state.upsertMergeRequest(project.id, {
      iid: 7,
      title: "MR",
      web_url: "https://gitlab.example.com/group/service/-/merge_requests/7",
      sha: "abc123",
      labels: [],
      draft: false,
      state: "opened",
      updated_at: new Date().toISOString()
    });
    const runId = await state.startRun(project.id, 7, "abc123");
    await state.addReviewEvent({
      runType: "mr",
      runId,
      level: "info",
      step: "codex_started",
      message: "Codex review started.",
      metadata: { model: "gpt-5.5", modelReasoningEffort: "xhigh", promptVersion: "ko-workspace-review-v3" }
    });
    await state.addReviewEvent({
      runType: "mr",
      runId,
      level: "info",
      step: "codex_usage",
      message: "Codex turn usage recorded.",
      metadata: { input_tokens: 100, output_tokens: 50, reasoning_output_tokens: 25 }
    });

    const rows = await state.listMergeRequestViews(userId);
    expect(rows[0]?.reviewMeta).toEqual({
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      promptVersion: "ko-workspace-review-v3",
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 25,
      totalTokens: 150
    });
    await db.$disconnect();
  });

  it("stores review events with user-scoped access and sanitized metadata", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userA = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const userB = await insertTestUser(db, { gitlabUserId: 2, username: "bob" });
    const projectA = await state.createProject(userA, {
      gitlabProjectId: "group/service-a",
      displayName: "Alice service",
      enabled: true,
      skipLabels: []
    });

    const runId = await state.startRun(projectA.id, 12, "abc123");
    await state.addReviewEvent({
      runType: "mr",
      runId,
      level: "info",
      step: "diff_fetched",
      message: "GitLab MR diff fetched.",
      metadata: {
        diffFileCount: 2,
        token: "secret",
        rawPrompt: "prompt text",
        diffText: "diff --git"
      }
    });

    const events = await state.listReviewEvents(userA, "mr", runId);
    expect(events).toHaveLength(1);
    expect(events[0]?.metadata.diffFileCount).toBe(2);
    expect(events[0]?.metadata.token).toBeUndefined();
    expect(events[0]?.metadata.rawPrompt).toBeUndefined();
    expect(events[0]?.metadata.diffText).toBeUndefined();
    await expect(state.listReviewEvents(userB, "mr", runId)).rejects.toThrow("Review run not found");
    await db.$disconnect();
  });

  it("queues, claims, and completes review jobs", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const project = await state.createProject(userId, {
      gitlabProjectId: "group/service",
      displayName: "Service",
      enabled: true,
      skipLabels: []
    });
    const runId = await state.startRun(project.id, 42, "abc123", "queued");

    const job = await state.createReviewJob({
      kind: "mr_retry",
      userId,
      runType: "mr",
      runId,
      payload: { runId, token: "secret" }
    });

    expect(job.status).toBe("queued");
    expect(job.payload.token).toBeUndefined();

    const claimed = await state.claimNextReviewJob();
    expect(claimed?.id).toBe(job.id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);

    await state.completeReviewJob(job.id);
    expect(await state.claimNextReviewJob()).toBeNull();
    await db.$disconnect();
  });

  it("clears only review history data", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const project = await state.createProject(userId, {
      gitlabProjectId: "group/service",
      displayName: "Service",
      enabled: true,
      skipLabels: []
    });
    await state.upsertMergeRequest(project.id, {
      iid: 7,
      title: "MR",
      web_url: "https://gitlab.example.com/group/service/-/merge_requests/7",
      sha: "abc123",
      labels: [],
      draft: false,
      state: "opened",
      updated_at: new Date().toISOString()
    });
    const runId = await state.startRun(project.id, 7, "abc123", "queued");
    await state.addReviewEvent({ runType: "mr", runId, level: "info", step: "run_queued", message: "Queued." });
    await state.createReviewJob({ kind: "mr_retry", userId, runType: "mr", runId, payload: { runId } });

    await state.clearReviewHistory();

    expect(await state.listProjects(userId)).toHaveLength(1);
    expect(await state.listMergeRequestViews(userId)).toHaveLength(0);
    await expect(state.listReviewEvents(userId, "mr", runId)).rejects.toThrow("Review run not found");
    expect(await db.reviewJob.count()).toBe(0);
    await db.$disconnect();
  });
});
