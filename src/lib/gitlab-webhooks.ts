import { randomBytes, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./config";
import { GitLabClient, type GitLabCommit, type GitLabMergeRequest } from "./gitlab-client";
import { nowIso } from "./prisma";
import type { ReviewerBotService } from "./reviewer-bot";
import type { GitlabProjectRow, ReviewStateStore, SharedProjectGroup } from "./review-state";
import type { SecretStore } from "./secret-store";

type WebhookHandleResult = { accepted: boolean; queued: number; skipped: number; reason?: string };

type PushPayload = {
  object_kind?: string;
  event_name?: string;
  ref?: string;
  after?: string;
  checkout_sha?: string | null;
  project_id?: number;
  project?: { id?: number };
  commits?: Array<{
    id?: string;
    title?: string;
    message?: string;
    url?: string;
    timestamp?: string;
    author?: { name?: string };
  }>;
};

type MergeRequestPayload = {
  object_kind?: string;
  project?: { id?: number };
  object_attributes?: {
    iid?: number;
    title?: string;
    url?: string;
    state?: string;
    action?: string;
    target_branch?: string;
    source_branch?: string;
    work_in_progress?: boolean;
    draft?: boolean;
    last_commit?: { id?: string };
  };
  labels?: Array<{ title?: string }>;
  user?: { username?: string };
};

export class GitLabWebhookService {
  constructor(
    private readonly config: AppConfig,
    private readonly state: ReviewStateStore,
    private readonly reviewerBot: ReviewerBotService,
    private readonly secrets: SecretStore
  ) {}

  async ensureProjectWebhook(project: GitlabProjectRow, forceNewSecret = false): Promise<GitlabProjectRow> {
    const url = this.webhookUrl();
    try {
      const botConnection = await this.reviewerBot.getConnection();
      if (!botConnection) throw new Error("Reviewer bot token is not connected");

      const client = new GitLabClient(botConnection);
      const secret = !forceNewSecret && project.webhookSecretEncrypted
        ? this.secrets.decrypt(project.webhookSecretEncrypted)
        : randomBytes(32).toString("base64url");
      const encryptedSecret = this.secrets.encrypt(secret);
      const hooks = await client.listProjectHooks(project.gitlabProjectId);
      const existing = hooks.find((hook) => hook.id === project.webhookHookId) ?? hooks.find((hook) => hook.url === url);
      const hook = existing
        ? await client.updateProjectHook(project.gitlabProjectId, existing.id, { url, token: secret, name: "GitLab Codex Reviewer" })
        : await client.createProjectHook(project.gitlabProjectId, { url, token: secret, name: "GitLab Codex Reviewer" });

      return this.state.updateGitlabProjectWebhook(project.id, {
        webhookHookId: hook.id,
        webhookSecretEncrypted: encryptedSecret,
        webhookUrl: url,
        webhookLastVerifiedAt: nowIso(),
        webhookError: null
      });
    } catch (error) {
      return this.state.updateGitlabProjectWebhook(project.id, {
        webhookUrl: url,
        webhookError: errorMessage(error)
      });
    }
  }

  async resetProjectWebhook(gitlabProjectRefId: number): Promise<GitlabProjectRow> {
    const project = await this.state.getGitlabProject(gitlabProjectRefId);
    return this.ensureProjectWebhook(project, true);
  }

  async deleteProjectWebhook(gitlabProjectRefId: number): Promise<{ deleted: boolean; error: string | null }> {
    const project = await this.state.getGitlabProject(gitlabProjectRefId);
    const hookId = project.webhookHookId;
    if (!hookId) {
      await this.state.updateGitlabProjectWebhook(project.id, {
        webhookHookId: null,
        webhookSecretEncrypted: null,
        webhookUrl: null,
        webhookLastVerifiedAt: null,
        webhookError: null
      });
      return { deleted: false, error: null };
    }

    try {
      const botConnection = await this.reviewerBot.getConnection();
      if (!botConnection) throw new Error("Reviewer bot token is not connected");
      const client = new GitLabClient(botConnection);
      await client.deleteProjectHook(project.gitlabProjectId, hookId);
      await this.state.updateGitlabProjectWebhook(project.id, {
        webhookHookId: null,
        webhookSecretEncrypted: null,
        webhookUrl: null,
        webhookLastVerifiedAt: null,
        webhookError: null
      });
      return { deleted: true, error: null };
    } catch (error) {
      const message = errorMessage(error);
      await this.state.updateGitlabProjectWebhook(project.id, {
        webhookHookId: project.webhookHookId,
        webhookSecretEncrypted: project.webhookSecretEncrypted,
        webhookUrl: project.webhookUrl,
        webhookLastVerifiedAt: project.webhookLastVerifiedAt,
        webhookError: message
      });
      return { deleted: false, error: message };
    }
  }

  async handleWebhook(eventName: string | null, token: string | null, payload: unknown): Promise<WebhookHandleResult> {
    if (!eventName) return { accepted: false, queued: 0, skipped: 1, reason: "Missing X-Gitlab-Event" };
    if (!token) return { accepted: false, queued: 0, skipped: 1, reason: "Missing X-Gitlab-Token" };
    if (!isRecord(payload)) return { accepted: false, queued: 0, skipped: 1, reason: "Invalid webhook payload" };

    const projectId = extractProjectId(payload);
    if (!projectId) return { accepted: false, queued: 0, skipped: 1, reason: "Webhook payload does not include project id" };

    const project = await this.state.getGitlabProjectByGitlabId(this.config.gitlab.baseUrl, String(projectId));
    if (!project || !project.webhookSecretEncrypted) {
      return { accepted: false, queued: 0, skipped: 1, reason: "Webhook is not registered for this project" };
    }
    if (!this.matchesSecret(token, project.webhookSecretEncrypted)) {
      return { accepted: false, queued: 0, skipped: 1, reason: "Webhook token mismatch" };
    }

    const group = await this.state.getSharedProjectGroup(project.id);
    if (!group) return { accepted: true, queued: 0, skipped: 1, reason: "No enabled subscriptions for project" };

    if (eventName === "Push Hook" || eventName === "Tag Push Hook") {
      return this.handlePush(group, payload as PushPayload);
    }
    if (eventName === "Merge Request Hook") {
      return this.handleMergeRequest(group, payload as MergeRequestPayload);
    }

    return { accepted: true, queued: 0, skipped: 1, reason: `Unsupported webhook event: ${eventName}` };
  }

  private async handlePush(group: SharedProjectGroup, payload: PushPayload): Promise<WebhookHandleResult> {
    const tagName = tagNameFromRef(payload.ref);
    if (tagName) return this.handleTagPush(group, tagName, payload);

    const branchName = branchNameFromRef(payload.ref);
    if (!branchName) return { accepted: true, queued: 0, skipped: 1, reason: "Push event has no branch ref" };
    if (!group.commitBranches.includes(branchName)) {
      return { accepted: true, queued: 0, skipped: 1, reason: `Branch is not configured for commit review: ${branchName}` };
    }

    let queued = 0;
    let skipped = 0;
    for (const commit of commitsFromPushPayload(payload)) {
      const existing = await this.state.findSharedCommitRun(group.gitlabProject.id, commit.id);
      if (existing) {
        skipped += 1;
        continue;
      }

      const runId = await this.state.startSharedCommitRun(
        group.representative.userId,
        group.representative.id,
        group.gitlabProject.id,
        group.gitlabProject.gitlabProjectId,
        branchName,
        commit,
        "auto",
        "queued"
      );
      await this.state.addReviewEvent({
        runType: "commit",
        runId,
        level: "info",
        step: "run_queued",
        message: "Commit review queued from GitLab webhook.",
        metadata: { project: group.gitlabProject.gitlabProjectId, sha: shortSha(commit.id), branchName, trigger: "webhook" }
      });
      await this.state.createReviewJob({
        kind: "commit_webhook",
        userId: group.representative.userId,
        runType: "commit",
        runId,
        payload: {
          gitlabProjectRefId: group.gitlabProject.id,
          gitlabProjectId: group.gitlabProject.gitlabProjectId,
          commitSha: commit.id,
          branchName
        }
      });
      queued += 1;
    }

    return { accepted: true, queued, skipped, reason: queued ? undefined : "No new commits to queue" };
  }

  private async handleTagPush(group: SharedProjectGroup, tagName: string, payload: PushPayload): Promise<WebhookHandleResult> {
    if (!group.gitlabProject.releaseNotesEnabled) {
      return { accepted: true, queued: 0, skipped: 1, reason: "Release notes are disabled for this project" };
    }
    if (!isReleaseTagName(tagName)) {
      return { accepted: true, queued: 0, skipped: 1, reason: `Tag is not a release tag: ${tagName}` };
    }

    const tagSha = tagShaFromPayload(payload);
    if (!tagSha) return { accepted: true, queued: 0, skipped: 1, reason: "Tag push is a delete event or missing tag sha" };

    const { releaseNote, entry } = await this.state.createQueuedReleaseNote({
      gitlabProjectRefId: group.gitlabProject.id,
      gitlabProjectId: group.gitlabProject.gitlabProjectId,
      projectName: projectDisplayName(group),
      tagName,
      tagSha,
      tagUrl: tagWebUrl(group.gitlabProject.webUrl, tagName),
      trigger: "webhook",
      createdByUserId: group.representative.userId
    });
    await this.state.addReviewEvent({
      runType: "release_note",
      runId: entry.id,
      level: "info",
      step: "release_note_queued",
      message: "Tag webhook release note generation queued; waiting for worker.",
      metadata: {
        trigger: "webhook",
        releaseNoteId: releaseNote.id,
        gitlabProjectId: group.gitlabProject.gitlabProjectId,
        tagName,
        tagSha
      }
    });
    await this.state.createReviewJob({
      kind: "release_note_webhook",
      userId: group.representative.userId,
      payload: {
        releaseNoteId: releaseNote.id,
        releaseNoteEntryId: entry.id,
        gitlabProjectRefId: group.gitlabProject.id,
        gitlabProjectId: group.gitlabProject.gitlabProjectId,
        tagName,
        tagSha
      }
    });
    return { accepted: true, queued: 1, skipped: 0 };
  }

  private async handleMergeRequest(group: SharedProjectGroup, payload: MergeRequestPayload): Promise<WebhookHandleResult> {
    const mrIid = payload.object_attributes?.iid;
    const headSha = payload.object_attributes?.last_commit?.id;
    const targetBranch = payload.object_attributes?.target_branch ?? null;
    const state = payload.object_attributes?.state;
    if (!mrIid || !headSha) return { accepted: true, queued: 0, skipped: 1, reason: "Merge request payload is missing iid or head sha" };
    if (state && state !== "opened") return { accepted: true, queued: 0, skipped: 1, reason: `Merge request is not opened: ${state}` };
    if (!group.mrTargetBranches.length) {
      return { accepted: true, queued: 0, skipped: 1, reason: "MR review is disabled for this project" };
    }
    if (!targetBranch || !group.mrTargetBranches.includes(targetBranch)) {
      return { accepted: true, queued: 0, skipped: 1, reason: `Target branch is not configured for MR review: ${targetBranch}` };
    }

    const mr = mergeRequestFromPayload(payload, mrIid, headSha);
    await this.state.upsertMergeRequestShared(group.gitlabProject.id, group.representative.id, mr);
    if (shouldSkipGroup(group, mr)) return { accepted: true, queued: 0, skipped: 1, reason: "Merge request matches skip rules" };

    const existing = await this.state.findSharedRun(group.gitlabProject.id, mrIid, headSha);
    if (existing) return { accepted: true, queued: 0, skipped: 1, reason: "Review run already exists for MR head sha" };

    const runId = await this.state.startSharedRun(group.gitlabProject.id, group.representative.id, mrIid, headSha, "queued");
    await this.state.addReviewEvent({
      runType: "mr",
      runId,
      level: "info",
      step: "run_queued",
      message: "MR review queued from GitLab webhook.",
      metadata: { project: group.gitlabProject.gitlabProjectId, sha: shortSha(headSha), mrIid, targetBranch, trigger: "webhook" }
    });
    await this.state.createReviewJob({
      kind: "mr_webhook",
      userId: group.representative.userId,
      runType: "mr",
      runId,
      payload: {
        gitlabProjectRefId: group.gitlabProject.id,
        gitlabProjectId: group.gitlabProject.gitlabProjectId,
        projectId: group.representative.id,
        mrIid,
        headSha
      }
    });
    return { accepted: true, queued: 1, skipped: 0 };
  }

  private webhookUrl(): string {
    return `${this.config.publicBaseUrl}/api/gitlab/webhook`;
  }

  private matchesSecret(token: string, encryptedSecret: string): boolean {
    try {
      const expected = this.secrets.decrypt(encryptedSecret);
      const left = Buffer.from(token);
      const right = Buffer.from(expected);
      return left.length === right.length && timingSafeEqual(left, right);
    } catch {
      return false;
    }
  }
}

function extractProjectId(payload: Record<string, unknown>): number | null {
  const project = isRecord(payload.project) ? payload.project : null;
  const nested = typeof project?.id === "number" ? project.id : null;
  if (nested) return nested;
  return typeof payload.project_id === "number" ? payload.project_id : null;
}

function branchNameFromRef(ref: string | undefined): string | null {
  const prefix = "refs/heads/";
  if (!ref?.startsWith(prefix)) return null;
  return ref.slice(prefix.length);
}

function tagNameFromRef(ref: string | undefined): string | null {
  const prefix = "refs/tags/";
  if (!ref?.startsWith(prefix)) return null;
  return ref.slice(prefix.length);
}

function commitsFromPushPayload(payload: PushPayload): GitLabCommit[] {
  const commits = (payload.commits ?? [])
    .map((commit) => commitFromPushCommit(commit))
    .filter((commit): commit is GitLabCommit => Boolean(commit?.id && !isZeroSha(commit.id)));
  if (commits.length) return commits;

  const sha = payload.checkout_sha || payload.after;
  if (!sha || isZeroSha(sha)) return [];
  return [{ id: sha, title: sha.slice(0, 10) }];
}

function commitFromPushCommit(commit: NonNullable<PushPayload["commits"]>[number]): GitLabCommit | null {
  if (!commit.id) return null;
  return {
    id: commit.id,
    title: commit.title ?? commit.message?.split("\n")[0] ?? commit.id.slice(0, 10),
    message: commit.message,
    web_url: commit.url,
    author_name: commit.author?.name,
    committed_date: commit.timestamp,
    created_at: commit.timestamp
  };
}

function mergeRequestFromPayload(payload: MergeRequestPayload, mrIid: number, headSha: string): GitLabMergeRequest {
  const attrs = payload.object_attributes;
  return {
    iid: mrIid,
    title: attrs?.title ?? `Merge request !${mrIid}`,
    web_url: attrs?.url ?? "",
    sha: headSha,
    target_branch: attrs?.target_branch,
    source_branch: attrs?.source_branch,
    labels: (payload.labels ?? []).map((label) => label.title).filter((label): label is string => Boolean(label)),
    draft: Boolean(attrs?.draft),
    work_in_progress: Boolean(attrs?.work_in_progress),
    state: attrs?.state ?? "opened",
    updated_at: new Date().toISOString(),
    author: { username: payload.user?.username }
  };
}

function shouldSkipGroup(group: SharedProjectGroup, mr: GitLabMergeRequest): boolean {
  if (mr.draft || mr.work_in_progress) return true;
  const skipLabels = new Set(group.skipLabels.map((label) => label.toLowerCase()));
  return (mr.labels ?? []).some((label) => skipLabels.has(label.toLowerCase()));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isZeroSha(sha: string): boolean {
  return /^0+$/.test(sha);
}

function tagShaFromPayload(payload: PushPayload): string | null {
  const sha = payload.checkout_sha || payload.after;
  if (!sha || isZeroSha(sha)) return null;
  return sha;
}

function isReleaseTagName(tagName: string): boolean {
  return tagName.startsWith("v");
}

function tagWebUrl(projectWebUrl: string | null, tagName: string): string | null {
  if (!projectWebUrl) return null;
  return `${projectWebUrl.replace(/\/$/, "")}/-/tags/${encodeURIComponent(tagName)}`;
}

function projectDisplayName(group: SharedProjectGroup): string {
  return group.gitlabProject.nameWithNamespace ?? group.gitlabProject.pathWithNamespace ?? group.representative.displayName;
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
