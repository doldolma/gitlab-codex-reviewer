import { describe, expect, it } from "vitest";
import { projectDisplayParts, ReviewStateStore } from "../lib/review-state";
import { insertTestUser, testDb } from "./test-utils";

describe("multi-user review state", () => {
  it("derives project list display names from GitLab namespace metadata", () => {
    expect(projectDisplayParts({
      nameWithNamespace: "RENEW / LIME / basket-cli",
      pathWithNamespace: null,
      displayName: "legacy"
    })).toEqual({
      projectName: "basket-cli",
      namespaceName: "RENEW / LIME"
    });

    expect(projectDisplayParts({
      nameWithNamespace: null,
      pathWithNamespace: "company/product/service",
      displayName: "legacy"
    })).toEqual({
      projectName: "service",
      namespaceName: "company / product"
    });

    expect(projectDisplayParts({
      nameWithNamespace: null,
      pathWithNamespace: "single-project",
      displayName: "legacy"
    })).toEqual({
      projectName: "single-project",
      namespaceName: null
    });

    expect(projectDisplayParts({
      nameWithNamespace: null,
      pathWithNamespace: null,
      displayName: "Legacy Project"
    })).toEqual({
      projectName: "Legacy Project",
      namespaceName: null
    });
  });

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
    const projectsForA = await state.listProjects(userA);
    const projectsForB = await state.listProjects(userB);
    expect(projectsForA).toHaveLength(2);
    expect(projectsForB).toHaveLength(2);
    expect(projectsForA.find((project) => project.displayName === "Alice service")?.skipLabels).toEqual(["skip-a"]);
    expect(projectsForB.find((project) => project.displayName === "Bob service")?.skipLabels).toEqual(["skip-b"]);
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
      enabled: false,
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

  it("does not treat empty MR branch settings as all branches", async () => {
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
      skipLabels: [],
      mrTargetBranches: [],
      commitBranches: ["main"]
    });
    await state.createProject(userB, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Bob service",
      enabled: true,
      skipLabels: [],
      mrTargetBranches: [],
      commitBranches: ["develop"]
    });

    const groups = await state.listSharedProjectGroups();

    expect(groups).toHaveLength(1);
    expect(groups[0]?.mrTargetBranches).toEqual([]);
    expect(groups[0]?.commitBranches.sort()).toEqual(["develop", "main"]);
    await db.$disconnect();
  });

  it("updates shared MR and branch watch rows without relying on nullable unique upsert", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service"
    });
    const project = await state.createProject(userId, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Service",
      enabled: true,
      skipLabels: [],
      mrTargetBranches: ["main"],
      commitBranches: ["main"]
    });

    await state.upsertMergeRequestShared(shared.id, project.id, {
      iid: 7,
      title: "Initial title",
      web_url: "https://gitlab.example.com/group/service/-/merge_requests/7",
      labels: [],
      sha: "aaa",
      state: "opened",
      draft: false
    } as any);
    await state.upsertMergeRequestShared(shared.id, project.id, {
      iid: 7,
      title: "Updated title",
      web_url: "https://gitlab.example.com/group/service/-/merge_requests/7",
      labels: ["review"],
      sha: "bbb",
      state: "opened",
      draft: false
    } as any);

    await state.setSharedBranchWatchState(shared.id, project.id, "main", "aaa");
    const branch = await state.setSharedBranchWatchState(shared.id, project.id, "main", "bbb");

    const mrs = await state.listMergeRequestViews(userId);
    expect(mrs).toHaveLength(1);
    expect(mrs[0]?.title).toBe("Updated title");
    expect(mrs[0]?.headSha).toBe("bbb");
    expect(branch.lastSeenSha).toBe("bbb");
    await db.$disconnect();
  });

  it("exposes webhook status from the shared GitLab project", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service"
    });
    await state.updateGitlabProjectWebhook(shared.id, {
      webhookHookId: 77,
      webhookSecretEncrypted: "encrypted-secret",
      webhookUrl: "https://reviewer.example.com/api/gitlab/webhook",
      webhookLastVerifiedAt: "2026-04-26T00:00:00.000Z",
      webhookError: null
    });
    await state.createProject(userId, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Service",
      enabled: true,
      skipLabels: []
    });

    const projects = await state.listProjects(userId);

    expect(projects[0]?.webhookStatus).toBe("connected");
    expect(projects[0]?.webhookUrl).toBe("https://reviewer.example.com/api/gitlab/webhook");
    await db.$disconnect();
  });

  it("counts remaining subscriptions for a shared GitLab project", async () => {
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
    const projectA = await state.createProject(userA, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Alice service",
      enabled: true,
      skipLabels: []
    });
    const projectB = await state.createProject(userB, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Bob service",
      enabled: true,
      skipLabels: []
    });

    expect(await state.countProjectSubscriptions(shared.id)).toBe(2);
    await state.deleteProject(userA, projectA.id);
    expect(await state.countProjectSubscriptions(shared.id)).toBe(1);
    await state.deleteProject(userB, projectB.id);
    expect(await state.countProjectSubscriptions(shared.id)).toBe(0);
    await db.$disconnect();
  });

  it("lets any subscribed user update the shared project review strategy", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userA = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const userB = await insertTestUser(db, { gitlabUserId: 2, username: "bob" });
    const outsider = await insertTestUser(db, { gitlabUserId: 3, username: "mallory" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service"
    });
    const projectA = await state.createProject(userA, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Alice service",
      enabled: true,
      skipLabels: []
    });
    const projectB = await state.createProject(userB, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Bob service",
      enabled: true,
      skipLabels: []
    });

    expect(projectA.reviewStrategy).toBe("auto");
    const updatedByA = await state.updateGitlabProjectReviewStrategy(userA, projectA.id, "thorough");
    expect(updatedByA.reviewStrategy).toBe("thorough");
    expect(updatedByA.reviewStrategyUpdatedByUserId).toBe(userA);
    expect((await state.listProjects(userB))[0]?.reviewStrategy).toBe("thorough");

    const updatedByB = await state.updateGitlabProjectReviewStrategy(userB, projectB.id, "fast");
    expect(updatedByB.reviewStrategy).toBe("fast");
    expect(updatedByB.reviewStrategyUpdatedByUserId).toBe(userB);
    const updatedByOutsider = await state.updateGitlabProjectReviewStrategy(outsider, projectA.id, "balanced");
    expect(updatedByOutsider.reviewStrategy).toBe("balanced");

    await db.$disconnect();
  });

  it("stores release note settings and generated notes on the shared project", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const otherUserId = await insertTestUser(db, { gitlabUserId: 2, username: "bob" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service",
      webUrl: "https://gitlab.example.com/group/service"
    });
    const project = await state.createProject(userId, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Service",
      enabled: true,
      skipLabels: []
    });

    const updated = await state.updateGitlabProjectReleaseNotesEnabled(userId, project.id, true);
    expect(updated.releaseNotesEnabled).toBe(true);
    const { releaseNote, entry } = await state.createQueuedReleaseNote({
      gitlabProjectRefId: shared.id,
      gitlabProjectId: shared.gitlabProjectId,
      projectName: "Group / Service",
      tagName: "v1.2.0",
      tagSha: "tag-sha",
      tagUrl: "https://gitlab.example.com/group/service/-/tags/v1.2.0",
      trigger: "manual",
      createdByUserId: userId
    });

    await state.markReleaseNoteEntryRunning(entry.id);
    await state.finishReleaseNoteEntry(entry.id, {
      title: "v1.2.0 릴리즈",
      notesMarkdown: "# v1.2.0 릴리즈",
      previousTagName: "v1.1.0",
      previousTagSha: "previous-sha",
      commitCount: 3,
      releaseUrl: "https://gitlab.example.com/group/service/-/releases/v1.2.0",
      structured: {
        releaseLanguage: "ko-KR",
        title: "v1.2.0 릴리즈",
        overview: "사용자에게 보이는 개선을 정리합니다.",
        highlights: [],
        improvements: [],
        fixes: [],
        upgradeNotes: [],
        knownLimitations: [],
        closingNote: "업데이트하세요."
      }
    });

    const notes = await state.listReleaseNotes(userId);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.status).toBe("completed");
    expect(notes[0]?.previousTagName).toBe("v1.1.0");
    expect(notes[0]?.releaseUrl).toBe("https://gitlab.example.com/group/service/-/releases/v1.2.0");
    expect(notes[0]?.structured?.title).toBe("v1.2.0 릴리즈");
    expect(notes[0]?.entries).toHaveLength(1);
    expect(notes[0]?.entries[0]?.notesMarkdown).toBe("# v1.2.0 릴리즈");
    expect(await state.listReleaseNotes(otherUserId)).toHaveLength(1);
    await db.$disconnect();
  });

  it("stores release note domain context on the shared project", async () => {
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
    const projectA = await state.createProject(userA, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Alice service",
      enabled: true,
      skipLabels: []
    });
    const projectB = await state.createProject(userB, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Bob service",
      enabled: true,
      skipLabels: []
    });

    await state.updateProjectReleaseNotesContext(userA, projectA.id, " 운영자는 정산 정확도를 중요하게 봅니다. ");

    expect(await state.getProjectReleaseNotesContext(userB, projectB.id)).toEqual({
      context: "운영자는 정산 정확도를 중요하게 봅니다."
    });
    expect(await state.getSharedProjectReleaseNotesContext(shared.id)).toBe("운영자는 정산 정확도를 중요하게 봅니다.");
    await db.$disconnect();
  });

  it("keeps previous release note entries when the same tag is generated again", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service"
    });

    const first = await state.createQueuedReleaseNote({
      gitlabProjectRefId: shared.id,
      gitlabProjectId: shared.gitlabProjectId,
      projectName: "Group / Service",
      tagName: "v1.2.0",
      tagSha: "tag-sha",
      trigger: "manual",
      createdByUserId: userId
    });
    await state.finishReleaseNoteEntry(first.entry.id, {
      title: "첫 릴리즈노트",
      notesMarkdown: "first markdown",
      structured: releaseNoteFixture("첫 릴리즈노트"),
      previousTagName: "v1.1.0",
      previousTagSha: "previous",
      commitCount: 2
    });
    const second = await state.createQueuedReleaseNote({
      gitlabProjectRefId: shared.id,
      gitlabProjectId: shared.gitlabProjectId,
      projectName: "Group / Service",
      tagName: "v1.2.0",
      tagSha: "tag-sha",
      trigger: "manual",
      createdByUserId: userId
    });
    await state.finishReleaseNoteEntry(second.entry.id, {
      title: "추가 릴리즈노트",
      notesMarkdown: "second markdown",
      structured: releaseNoteFixture("추가 릴리즈노트"),
      previousTagName: "v1.1.0",
      previousTagSha: "previous",
      commitCount: 2
    });

    const notes = await state.listReleaseNotes(userId);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.notesMarkdown).toBe("second markdown");
    expect(notes[0]?.entries.map((entry) => entry.notesMarkdown)).toEqual(["second markdown", "first markdown"]);
    await db.$disconnect();
  });

  it("stores release note entry events with team-wide access", async () => {
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
    const { entry } = await state.createQueuedReleaseNote({
      gitlabProjectRefId: shared.id,
      gitlabProjectId: shared.gitlabProjectId,
      projectName: "Group / Service",
      tagName: "v1.2.0",
      tagSha: "tag-sha",
      trigger: "manual",
      createdByUserId: userA
    });
    await state.addReviewEvent({
      runType: "release_note",
      runId: entry.id,
      level: "info",
      step: "release_note_queued",
      message: "Queued.",
      metadata: {
        tagName: "v1.2.0",
        token: "secret",
        diffText: "diff --git"
      }
    });

    const events = await state.listReviewEvents(userA, "release_note", entry.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.runType).toBe("release_note");
    expect(events[0]?.metadata.tagName).toBe("v1.2.0");
    expect(events[0]?.metadata.token).toBeUndefined();
    expect(events[0]?.metadata.diffText).toBeUndefined();
    expect(await state.listReviewEvents(userB, "release_note", entry.id)).toHaveLength(1);
    await expect(state.listReviewEvents(userA, "release_note", entry.id + 1)).rejects.toThrow("Release note entry not found");
    await db.$disconnect();
  });

  it("stores shared project review config for subscribed users only", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userA = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const userB = await insertTestUser(db, { gitlabUserId: 2, username: "bob" });
    const outsider = await insertTestUser(db, { gitlabUserId: 3, username: "mallory" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service"
    });
    const projectA = await state.createProject(userA, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Alice service",
      enabled: true,
      skipLabels: []
    });
    const projectB = await state.createProject(userB, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: "123",
      displayName: "Bob service",
      enabled: true,
      skipLabels: []
    });

    const updated = await state.updateProjectReviewConfig(userA, projectA.id, {
      reviewProfile: "chill",
      pathFilters: ["src/**", "!src/generated/**"],
      instructions: [
        {
          pathGlob: "src/grpc/**",
          instructions: "stream lifecycle과 context cancel을 확인하세요.",
          enabled: true
        }
      ]
    });

    expect(updated.reviewProfile).toBe("chill");
    expect(updated.pathFilters).toEqual(["src/**", "!src/generated/**"]);
    expect(updated.instructions).toHaveLength(1);
    expect((await state.getProjectReviewConfig(userB, projectB.id)).reviewProfile).toBe("chill");
    expect((await state.getProjectReviewConfig(outsider, projectA.id)).reviewProfile).toBe("chill");
    await db.$disconnect();
  });

  it("shows merge request and review views to every logged-in user", async () => {
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
    expect(await state.listMergeRequestViews(userB)).toHaveLength(1);
    await db.$disconnect();
  });

  it("keeps branch watch states per project but shows commit review runs to every logged-in user", async () => {
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
    expect((await state.listCommitReviewRuns(userA)).commitReviews).toHaveLength(1);
    expect((await state.listCommitReviewRuns(userB)).commitReviews).toHaveLength(1);
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

    const runs = (await state.listCommitReviewRuns(userId)).commitReviews;
    expect(runs).toHaveLength(1);
    expect(runs[0]?.projectName).toBe("group/manual-only");
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.reviewMeta).toBeNull();
    await db.$disconnect();
  });

  it("paginates commit review runs and reports active counts", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });

    for (let index = 1; index <= 25; index += 1) {
      const suffix = String(index).padStart(2, "0");
      await state.startCommitRun(
        userId,
        null,
        "group/manual-only",
        "main",
        { id: `commit-${suffix}`, title: `Commit ${suffix}` },
        "manual"
      );
    }

    const firstPage = await state.listCommitReviewRuns(userId, { page: 1, pageSize: 20 });
    expect(firstPage.commitReviews).toHaveLength(20);
    expect(firstPage.commitReviews[0]?.commitSha).toBe("commit-25");
    expect(firstPage.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 25,
      totalPages: 2,
      hasPrev: false,
      hasNext: true
    });
    expect(firstPage.activeCount).toBe(25);

    const secondPage = await state.listCommitReviewRuns(userId, { page: 2, pageSize: 20 });
    expect(secondPage.commitReviews.map((run) => run.commitSha)).toEqual(["commit-05", "commit-04", "commit-03", "commit-02", "commit-01"]);
    expect(secondPage.pagination.hasPrev).toBe(true);
    expect(secondPage.pagination.hasNext).toBe(false);

    const clampedPageSize = await state.listCommitReviewRuns(userId, { page: 1, pageSize: 999 });
    expect(clampedPageSize.pagination.pageSize).toBe(100);
    await db.$disconnect();
  });

  it("paginates merge request views and reports active counts", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const project = await state.createProject(userId, {
      gitlabProjectId: "group/service",
      displayName: "Service",
      enabled: true,
      skipLabels: []
    });

    for (let index = 1; index <= 25; index += 1) {
      const suffix = String(index).padStart(2, "0");
      const sha = `head-${suffix}`;
      await state.upsertMergeRequest(project.id, {
        iid: index,
        title: `MR ${suffix}`,
        web_url: `https://gitlab.example.com/group/service/-/merge_requests/${index}`,
        sha,
        labels: [],
        draft: false,
        state: "opened",
        updated_at: new Date().toISOString()
      });
      await state.startRun(project.id, index, sha, "queued");
    }

    const firstPage = await state.listMergeRequestViews(userId, { page: 1, pageSize: 20 });
    expect(firstPage.mergeRequests).toHaveLength(20);
    expect(firstPage.mergeRequests[0]?.mrIid).toBe(25);
    expect(firstPage.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 25,
      totalPages: 2,
      hasPrev: false,
      hasNext: true
    });
    expect(firstPage.activeCount).toBe(25);

    const secondPage = await state.listMergeRequestViews(userId, { page: 2, pageSize: 20 });
    expect(secondPage.mergeRequests.map((mr) => mr.mrIid)).toEqual([5, 4, 3, 2, 1]);
    expect(secondPage.pagination.hasPrev).toBe(true);
    expect(secondPage.pagination.hasNext).toBe(false);

    const clampedPageSize = await state.listMergeRequestViews(userId, { page: 1, pageSize: 999 });
    expect(clampedPageSize.pagination.pageSize).toBe(100);
    await db.$disconnect();
  });

  it("stores manual commit review strategy override", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service"
    });

    const runId = await state.startSharedCommitRun(
      userId,
      null,
      shared.id,
      shared.gitlabProjectId,
      "main",
      { id: "strategy123", title: "Manual strategy test" },
      "manual",
      "queued",
      "thorough"
    );

    const run = await state.getCommitRunById(userId, runId);
    expect(run?.reviewStrategyOverride).toBe("thorough");
    await db.$disconnect();
  });

  it("uses shared GitLab project name for commit review rows", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "469",
      pathWithNamespace: "renew/lime/collector",
      nameWithNamespace: "RENEW / LIME / Collector"
    });

    await state.startSharedCommitRun(
      userId,
      null,
      shared.id,
      shared.gitlabProjectId,
      "main",
      { id: "name123", title: "Name test" },
      "manual",
      "queued"
    );

    const runs = (await state.listCommitReviewRuns(userId)).commitReviews;
    expect(runs[0]?.projectName).toBe("RENEW / LIME / Collector");
    await db.$disconnect();
  });

  it("stores structured review output and team-visible feedback", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const otherUserId = await insertTestUser(db, { gitlabUserId: 2, username: "bob" });
    const runId = await state.startCommitRun(userId, null, "group/manual-only", "main", { id: "feedback123", title: "Feedback test" }, "manual");
    await state.finishCommitCommented(
      runId,
      { id: 1, url: "https://gitlab.example.com/comment/1" },
      "markdown",
      {
        reviewLanguage: "ko-KR",
        assessment: "needs_revision",
        changeIntent: "수동 커밋 리뷰의 구조화 결과 저장을 검증하는 변경입니다.",
        reviewEffort: { score: 3, reason: "중간 범위 변경입니다." },
        changedFilesSummary: [],
        riskAreas: [],
        summary: [],
        criticalIssues: [],
        potentialIssues: [
          {
            severity: "medium",
            confidence: 0.8,
            category: "bug",
            title: "경계값 오류",
            file: "src/app.ts",
            line: 10,
            details: "경계값에서 실패합니다.",
            impact: "요청이 실패할 수 있습니다.",
            recommendation: "경계값 처리를 추가하세요."
          }
        ],
        suggestions: [],
        testSuggestions: [],
        notes: [],
        flowSummary: [],
        toolFindingsUsed: [],
        confidenceReason: "근거가 충분합니다.",
        shouldPostComment: true,
        commentReason: "조치가 필요합니다."
      }
    );

    expect((await state.getCommitRunById(userId, runId))?.structuredReview?.potentialIssues[0]?.title).toBe("경계값 오류");
    await state.addReviewFeedback(userId, "commit", runId, {
      issueFingerprint: "src/app.ts:10:경계값 오류",
      rating: "helpful"
    });
    await state.addReviewFeedback(otherUserId, "commit", runId, {
      issueFingerprint: "src/app.ts:10:경계값 오류",
      rating: "false_positive"
    });
    expect((await state.reviewQualityStats(userId)).feedbackCount).toBe(2);
    expect((await state.reviewQualityStats(otherUserId)).falsePositiveCount).toBe(1);
    await db.$disconnect();
  });

  it("cancels queued commit review runs and prevents job claim", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const runId = await state.startCommitRun(userId, null, "group/manual-only", "main", { id: "cancel123", title: "Cancel me" }, "manual", "queued");
    const job = await state.createReviewJob({ kind: "commit_manual", userId, runType: "commit", runId, payload: { commitSha: "cancel123" } });

    const canceled = await state.cancelCommitRun(userId, runId);

    expect(canceled.status).toBe("canceled");
    expect(await state.isReviewJobCanceled(job.id)).toBe(true);
    expect(await state.claimNextReviewJob()).toBeNull();
    await db.$disconnect();
  });

  it("releases shared project and commit locks when canceling a retry job with run-only payload", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service"
    });
    const runId = await state.startSharedCommitRun(
      userId,
      null,
      shared.id,
      shared.gitlabProjectId,
      "main",
      { id: "retry-lock-sha", title: "Retry lock" },
      "manual",
      "queued"
    );
    await state.createReviewJob({ kind: "commit_retry", userId, runType: "commit", runId, payload: { runId } });
    expect(await state.acquireLock(`project:${shared.gitlabHost}:${shared.gitlabProjectId}`)).toBe(true);
    expect(await state.acquireLock(`commit:${shared.id}:retry-lock-sha`)).toBe(true);

    await state.cancelCommitRun(userId, runId);

    expect(await state.acquireLock(`project:${shared.gitlabHost}:${shared.gitlabProjectId}`)).toBe(true);
    expect(await state.acquireLock(`commit:${shared.id}:retry-lock-sha`)).toBe(true);
    await db.$disconnect();
  });

  it("cancels queued MR review runs and related jobs", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const project = await state.createProject(userId, {
      gitlabProjectId: "group/service",
      displayName: "Service",
      enabled: true,
      skipLabels: []
    });
    const runId = await state.startRun(project.id, 7, "head123", "queued");
    const job = await state.createReviewJob({ kind: "mr_retry", userId, runType: "mr", runId, payload: { runId } });

    const canceled = await state.cancelRun(userId, runId);

    expect(canceled.status).toBe("canceled");
    expect(await state.isReviewJobCanceled(job.id)).toBe(true);
    expect(await state.claimNextReviewJob()).toBeNull();
    await db.$disconnect();
  });

  it("releases shared project and MR locks when canceling a retry job with run-only payload", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const shared = await state.upsertGitlabProject({
      gitlabHost: "https://gitlab.example.com",
      gitlabProjectId: "123",
      pathWithNamespace: "group/service",
      nameWithNamespace: "Group / Service"
    });
    const project = await state.createProject(userId, {
      gitlabProjectRefId: shared.id,
      gitlabProjectId: shared.gitlabProjectId,
      displayName: "Service",
      enabled: true,
      skipLabels: []
    });
    const runId = await state.startSharedRun(shared.id, project.id, 7, "head-sha", "queued");
    await state.createReviewJob({ kind: "mr_retry", userId, runType: "mr", runId, payload: { runId } });
    expect(await state.acquireLock(`project:${shared.gitlabHost}:${shared.gitlabProjectId}`)).toBe(true);
    expect(await state.acquireLock(`mr:${shared.id}:7:head-sha`)).toBe(true);

    await state.cancelRun(userId, runId);

    expect(await state.acquireLock(`project:${shared.gitlabHost}:${shared.gitlabProjectId}`)).toBe(true);
    expect(await state.acquireLock(`mr:${shared.id}:7:head-sha`)).toBe(true);
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

    const runs = (await state.listCommitReviewRuns(userId)).commitReviews;
    expect(runs[0]?.reviewMeta).toEqual({
      provider: "codex",
      providerLabel: "Codex 계정",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      promptVersion: "ko-workspace-review-v3",
      reviewStrategy: null,
      triageUsed: null,
      triageRiskLevel: null,
      triageReason: null,
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
      metadata: {
        model: "gpt-5.5",
        modelReasoningEffort: "xhigh",
        promptVersion: "ko-workspace-review-v3",
        reviewStrategy: "auto",
        triageUsed: true,
        triageRiskLevel: "high",
        triageReason: "스키마 변경"
      }
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
      provider: "codex",
      providerLabel: "Codex 계정",
      model: "gpt-5.5",
      reasoningEffort: "xhigh",
      promptVersion: "ko-workspace-review-v3",
      reviewStrategy: "auto",
      triageUsed: true,
      triageRiskLevel: "high",
      triageReason: "스키마 변경",
      inputTokens: 100,
      outputTokens: 50,
      reasoningTokens: 25,
      totalTokens: 150
    });
    await db.$disconnect();
  });

  it("reconstructs merge request comment links from legacy comment ids", async () => {
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
    await state.finishCommented(runId, { id: 123, url: null }, "review markdown", null);

    const rows = await state.listMergeRequestViews(userId);
    expect(rows[0]?.commentUrl).toBe("https://gitlab.example.com/group/service/-/merge_requests/7#note_123");
    await db.$disconnect();
  });

  it("stores review events with team-wide access and sanitized metadata", async () => {
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
    expect(await state.listReviewEvents(userB, "mr", runId)).toHaveLength(1);
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

  it("claims the next queued job outside excluded GitLab project refs", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });

    const first = await state.createReviewJob({
      kind: "commit_webhook",
      userId,
      runType: "commit",
      runId: null,
      payload: { gitlabProjectRefId: 101, gitlabProjectId: "101", commitSha: "a1" }
    });
    const second = await state.createReviewJob({
      kind: "commit_webhook",
      userId,
      runType: "commit",
      runId: null,
      payload: { gitlabProjectRefId: 101, gitlabProjectId: "101", commitSha: "a2" }
    });
    const third = await state.createReviewJob({
      kind: "commit_webhook",
      userId,
      runType: "commit",
      runId: null,
      payload: { gitlabProjectRefId: 202, gitlabProjectId: "202", commitSha: "b1" }
    });

    const claimed = await state.claimNextReviewJob({ excludedGitlabProjectRefIds: [101] });

    expect(claimed?.id).toBe(third.id);
    expect((await db.reviewJob.findUnique({ where: { id: first.id } }))?.status).toBe("queued");
    expect((await db.reviewJob.findUnique({ where: { id: second.id } }))?.status).toBe("queued");
    await db.$disconnect();
  });

  it("recovers stale running review jobs and queues them again", async () => {
    const db = await testDb();
    const state = new ReviewStateStore(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "alice" });
    const runId = await state.startCommitRun(userId, null, "group/service", "main", { id: "abc123", title: "Fix bug" }, "manual", "queued");
    const job = await state.createReviewJob({
      kind: "commit_manual",
      userId,
      runType: "commit",
      runId,
      payload: { commitSha: "abc123" }
    });
    const claimed = await state.claimNextReviewJob();
    expect(claimed?.id).toBe(job.id);
    await db.reviewJob.update({
      where: { id: job.id },
      data: { updatedAt: new Date(Date.now() - 10 * 60_000).toISOString() }
    });

    const recovered = await state.recoverStaleRunningJobs(2 * 60_000);

    expect(recovered).toBe(1);
    const recoveredJob = await db.reviewJob.findUnique({ where: { id: job.id } });
    expect(recoveredJob?.status).toBe("queued");
    const recoveredRun = await state.getCommitRunById(userId, runId);
    expect(recoveredRun?.status).toBe("queued");
    const events = await state.listReviewEvents(userId, "commit", runId);
    expect(events.some((event) => event.step === "job_recovered")).toBe(true);
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
    await state.createReviewJob({ kind: "commit_webhook", userId, runType: "commit", runId: null, payload: { commitSha: "abc123" } });

    await state.clearReviewHistory();

    expect(await state.listProjects(userId)).toHaveLength(1);
    expect(await state.listMergeRequestViews(userId)).toHaveLength(0);
    await expect(state.listReviewEvents(userId, "mr", runId)).rejects.toThrow("Review run not found");
    expect(await db.reviewJob.count()).toBe(0);
    await db.$disconnect();
  });
});

function releaseNoteFixture(title: string) {
  return {
    releaseLanguage: "ko-KR" as const,
    title,
    overview: "사용자에게 보이는 개선을 정리합니다.",
    highlights: [],
    improvements: [],
    fixes: [],
    upgradeNotes: [],
    knownLimitations: [],
    closingNote: "업데이트하세요."
  };
}
