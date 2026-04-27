import type { GitLabOAuthService } from "../lib/gitlab-oauth";
import type { AppConfig } from "../lib/config";
import { defaultModelSettings, runtimeSettings, type CodexReviewModelSettings, type CodexReviewRuntimeSettings } from "../lib/codex-review-settings";
import { CodexReviewEngine, type Reviewer } from "../lib/review-engine";
import { formatCommitDiffForReview, formatDiffForReview, type FormattedDiff } from "../lib/diff-formatter";
import { GitLabClient, type GitLabCommit, type GitLabDiff, type GitLabMergeRequest } from "../lib/gitlab-client";
import { GitWorkspaceManager } from "../lib/git-workspace";
import { logReview, type ReviewLogSource } from "../lib/logger";
import { publishCommitReviewNote, publishReviewNote } from "../lib/note-publisher";
import { REVIEW_PROMPT_VERSION, type PromptToolFinding, type ReviewIssue, type ReviewPromptInput } from "../lib/prompts";
import { publishMergeRequestInlineComments } from "../lib/inline-comment-publisher";
import type { ReviewerBotService } from "../lib/reviewer-bot";
import { defaultPathFilters, filterChangedFiles, matchReviewInstructions, type ProjectReviewConfig } from "../lib/review-config";
import { parseReviewStrategy, resolveFixedReviewStrategy, type ReviewStrategy, type ReviewStrategyResolution } from "../lib/review-strategy";
import { CodexReviewTriageEngine, type ReviewTriageRunner } from "../lib/review-triage";
import {
  ReviewStateStore,
  type CommitReviewRunView,
  type CommitReviewTrigger,
  type GitlabProjectRow,
  type ProjectRow,
  type ReviewEventLevel,
  type ReviewJobView,
  type ReviewRunRow,
  type ReviewRunType,
  type SharedProjectGroup
} from "../lib/review-state";
import { ReadonlyToolRunner, type ToolRunnerEvent } from "../lib/tool-runner";

type ScanSummary = { reviewed: number; skipped: number; errors: number };
type ReviewSettingsProvider = {
  getEffectiveReviewSettings(): Promise<CodexReviewModelSettings>;
};
type EventContext = {
  source: ReviewLogSource;
  runType: ReviewRunType;
  runId: number;
  project: string;
  sha: string;
};
type CancellationCheck = () => Promise<void>;

const REVIEW_JOB_HEARTBEAT_MS = 30_000;
const STALE_REVIEW_JOB_MS = 2 * 60_000;
const REVIEW_JOB_CANCEL_POLL_MS = 1_000;

class ReviewCanceledError extends Error {
  constructor() {
    super("Review was canceled");
    this.name = "ReviewCanceledError";
  }
}

export class ReviewWorker {
  private running = false;
  private missingReviewerBotWarningShown = false;

  constructor(
    private readonly config: AppConfig,
    private readonly oauth: GitLabOAuthService,
    private readonly state: ReviewStateStore,
    private readonly reviewerBot: ReviewerBotService,
    private readonly reviewer: Reviewer = new CodexReviewEngine(),
    private readonly triageRunner: ReviewTriageRunner = new CodexReviewTriageEngine(),
    private readonly reviewSettings: ReviewSettingsProvider = {
      async getEffectiveReviewSettings() {
        return defaultModelSettings();
      }
    },
    private readonly toolRunner: ReadonlyToolRunner = new ReadonlyToolRunner()
  ) {
    this.workspace = new GitWorkspaceManager(config);
  }

  private readonly workspace: GitWorkspaceManager;

  async scanOnce(userId?: number): Promise<ScanSummary> {
    const source: ReviewLogSource = userId ? "web" : "worker";
    if (this.running) {
      console.warn(`[${source}] [review] Scan skipped because another scan is already running.`);
      return { reviewed: 0, skipped: 0, errors: 0 };
    }
    this.running = true;
    let reviewed = 0;
    let skipped = 0;
    let errors = 0;

    try {
      const botConnection = await this.reviewerBot.getConnection();
      if (!botConnection) {
        if (source === "worker") {
          if (!this.missingReviewerBotWarningShown) {
            console.warn("[worker] [review] Background scan paused because reviewer bot token is not connected.");
            this.missingReviewerBotWarningShown = true;
          }
        } else {
          console.warn("[web] [review] Scan skipped because reviewer bot token is not connected.");
        }
        return { reviewed: 0, skipped: 1, errors: 0 };
      }
      this.missingReviewerBotWarningShown = false;
      console.log(`[${source}] [review] Scan started.`);
      const client = new GitLabClient(botConnection);
      const groups = await this.state.listSharedProjectGroups(userId);
      console.log(`[${source}] [review] Loaded ${groups.length} shared project group(s).`);
      for (const group of groups) {
        const projectLockKey = `project:${group.gitlabProject.gitlabHost}:${group.gitlabProject.gitlabProjectId}`;
        if (!(await this.state.acquireLock(projectLockKey))) {
          console.warn(`[${source}] [review] Project scan skipped because lock is held: ${group.gitlabProject.gitlabProjectId}.`);
          skipped += 1;
          continue;
        }
        try {
          const hydratedGroup = await this.ensureSharedProjectMetadata(client, group);
          const mrSummary = await this.scanMergeRequestsForGroup(client, botConnection.accessToken, hydratedGroup);
          reviewed += mrSummary.reviewed;
          skipped += mrSummary.skipped;
          errors += mrSummary.errors;

          const commitSummary = await this.scanCommitBranchesForGroup(client, botConnection.accessToken, hydratedGroup);
          reviewed += commitSummary.reviewed;
          skipped += commitSummary.skipped;
          errors += commitSummary.errors;
        } catch (error) {
          console.error(`[${source}] [review] Shared project scan failed: ${group.gitlabProject.gitlabProjectId}`, error);
          errors += 1;
        } finally {
          await this.state.releaseLock(projectLockKey);
        }
      }
      console.log(`[${source}] [review] Scan finished: reviewed=${reviewed}, skipped=${skipped}, errors=${errors}.`);
      return { reviewed, skipped, errors };
    } finally {
      this.running = false;
    }
  }

  async enqueueScan(userId: number): Promise<ReviewJobView> {
    return this.state.createReviewJob({
      kind: "scan_user",
      userId,
      payload: {}
    });
  }

  async enqueueCommitReviewManually(
    userId: number,
    input: { gitlabProjectId: string; commitSha: string; branchName?: string | null; reviewStrategy?: ReviewStrategy }
  ): Promise<{ run: CommitReviewRunView; job: ReviewJobView }> {
    console.log(`[web] [review] Manual commit review queued: project=${input.gitlabProjectId}, sha=${shortSha(input.commitSha)}.`);
    const reviewStrategy = parseReviewStrategy(input.reviewStrategy);
    const botConnection = await this.reviewerBot.getConnection();
    if (!botConnection) throw new Error("Reviewer bot token is not connected");
    const client = new GitLabClient(botConnection);
    const gitlabProject = await client.getProject(input.gitlabProjectId);
    const sharedProject = await this.state.upsertGitlabProject({
      gitlabHost: botConnection.gitlabHost,
      gitlabProjectId: String(gitlabProject.id),
      pathWithNamespace: gitlabProject.path_with_namespace,
      nameWithNamespace: gitlabProject.name_with_namespace,
      webUrl: gitlabProject.web_url ?? null,
      cloneHttpUrl: gitlabProject.http_url_to_repo ?? null,
      defaultBranch: gitlabProject.default_branch ?? null
    });
    const commit = await client.getCommit(sharedProject.gitlabProjectId, input.commitSha);
    const runId = await this.state.startSharedCommitRun(
      userId,
      null,
      sharedProject.id,
      sharedProject.gitlabProjectId,
      input.branchName ?? null,
      commit,
      "manual",
      "queued",
      reviewStrategy
    );
    const context: EventContext = { source: "web", runType: "commit", runId, project: sharedProject.gitlabProjectId, sha: commit.id };
    await this.recordEvent(context, "info", "run_queued", "Commit review queued; waiting for worker.", {
      branchName: input.branchName ?? null,
      trigger: "manual",
      reviewStrategy,
      sharedProjectId: sharedProject.id
    });
    const job = await this.state.createReviewJob({
      kind: "commit_manual",
      userId,
      runType: "commit",
      runId,
      payload: {
        gitlabProjectRefId: sharedProject.id,
        gitlabProjectId: sharedProject.gitlabProjectId,
        commitSha: commit.id,
        branchName: input.branchName ?? null,
        reviewStrategy
      }
    });
    const run = await this.state.getCommitRunById(userId, runId);
    if (!run) throw new Error("Commit review run not found");
    return { run, job };
  }

  async enqueueRetryRun(userId: number, runId: number): Promise<{ run: ReviewRunRow; job: ReviewJobView }> {
    const run = await this.state.markRunQueued(userId, runId);
    await this.recordEvent(
      { source: "web", runType: "mr", runId: run.id, project: run.gitlabProjectId, sha: run.headSha },
      "info",
      "run_queued",
      "MR review retry queued; waiting for worker.",
      { mrIid: run.mrIid }
    );
    const job = await this.state.createReviewJob({
      kind: "mr_retry",
      userId,
      runType: "mr",
      runId,
      payload: { runId }
    });
    return { run, job };
  }

  async enqueueRetryCommitRun(userId: number, runId: number): Promise<{ run: CommitReviewRunView; job: ReviewJobView }> {
    const run = await this.state.markCommitRunQueued(userId, runId);
    await this.recordEvent(
      { source: "web", runType: "commit", runId: run.id, project: run.gitlabProjectId, sha: run.commitSha },
      "info",
      "run_queued",
      "Commit review retry queued; waiting for worker.",
      { branchName: run.branchName, trigger: run.trigger, reviewStrategy: run.reviewStrategyOverride }
    );
    const job = await this.state.createReviewJob({
      kind: "commit_retry",
      userId,
      runType: "commit",
      runId,
      payload: { runId }
    });
    return { run, job };
  }

  async cancelReviewRun(userId: number, runId: number): Promise<ReviewRunRow> {
    const run = await this.state.cancelRun(userId, runId);
    await this.recordEvent(
      { source: "web", runType: "mr", runId: run.id, project: run.gitlabProjectId, sha: run.headSha },
      "warn",
      "run_canceled",
      "Review run was canceled by user.",
      { mrIid: run.mrIid }
    );
    return run;
  }

  async cancelCommitReview(userId: number, runId: number): Promise<CommitReviewRunView> {
    const run = await this.state.cancelCommitRun(userId, runId);
    await this.recordEvent(
      { source: "web", runType: "commit", runId: run.id, project: run.gitlabProjectId, sha: run.commitSha },
      "warn",
      "run_canceled",
      "Review run was canceled by user.",
      { branchName: run.branchName, trigger: run.trigger }
    );
    return run;
  }

  async processQueuedJobs(limit = 3): Promise<{ processed: number; deferred: number; failed: number; canceled: number }> {
    const recovered = await this.state.recoverStaleRunningJobs(STALE_REVIEW_JOB_MS);
    if (recovered > 0) {
      console.warn(`[worker] [review] Recovered ${recovered} stale running review job(s).`);
    }

    const jobs: ReviewJobView[] = [];
    for (let index = 0; index < limit; index += 1) {
      const job = await this.state.claimNextReviewJob();
      if (!job) break;
      jobs.push(job);
    }

    const results = await Promise.all(jobs.map((job) => this.processClaimedJob(job)));
    return {
      processed: results.filter((result) => result === "processed").length,
      deferred: results.filter((result) => result === "deferred").length,
      failed: results.filter((result) => result === "failed").length,
      canceled: results.filter((result) => result === "canceled").length
    };
  }

  private async processClaimedJob(job: ReviewJobView): Promise<"processed" | "deferred" | "failed" | "canceled"> {
    const abortController = new AbortController();
    const heartbeat = setInterval(() => {
      void this.state.heartbeatReviewJob(job.id).catch((error) => {
        console.warn(`[worker] [review] Failed to heartbeat job=${job.id}`, error);
      });
    }, REVIEW_JOB_HEARTBEAT_MS);
    heartbeat.unref?.();
    const cancelPoll = setInterval(() => {
      void this.state.isReviewJobCanceled(job.id).then((canceled) => {
        if (canceled && !abortController.signal.aborted) abortController.abort(new ReviewCanceledError());
      }).catch((error) => {
        console.warn(`[worker] [review] Failed to check cancellation for job=${job.id}`, error);
      });
    }, REVIEW_JOB_CANCEL_POLL_MS);
    cancelPoll.unref?.();

    try {
      const checkCancellation = async () => {
        throwIfCanceled(abortController.signal);
        if (await this.state.isReviewJobCanceled(job.id)) {
          abortController.abort(new ReviewCanceledError());
          throw new ReviewCanceledError();
        }
      };

      const result = await this.executeReviewJob(job, abortController.signal, checkCancellation);
      if (result === "deferred") return "deferred";
      if (await this.state.isReviewJobCanceled(job.id)) return "canceled";
      await this.state.completeReviewJob(job.id);
      return "processed";
    } catch (error) {
      if (isCancellationError(error, abortController.signal)) {
        if (job.runType && job.runId) await this.state.markRunCanceled(job.runType, job.runId);
        console.log(`[worker] [review] Job canceled: id=${job.id}, kind=${job.kind}`);
        return "canceled";
      }
      await this.failRunForJob(job, error);
      await this.state.failReviewJob(job.id, error);
      console.error(`[worker] [review] Job failed: id=${job.id}, kind=${job.kind}`, error);
      return "failed";
    } finally {
      clearInterval(heartbeat);
      clearInterval(cancelPoll);
    }
  }

  private async failRunForJob(job: ReviewJobView, error: unknown): Promise<void> {
    if (!job.runType || !job.runId) return;
    try {
      if (job.runType === "commit") {
        await this.state.failCommitRun(job.runId, error);
      } else {
        await this.state.failRun(job.runId, error);
      }
      await this.recordEvent(
        { source: "worker", runType: job.runType, runId: job.runId, project: stringFromPayload(job.payload, "gitlabProjectId") ?? "unknown", sha: stringFromPayload(job.payload, "commitSha") ?? String(job.runId) },
        "error",
        "run_failed",
        "Review job failed before the review could finish.",
        { jobId: job.id, kind: job.kind, error: errorMessage(error) }
      );
    } catch (eventError) {
      console.error(`[worker] [review] Failed to mark run failed for job=${job.id}`, eventError);
    }
  }

  private async executeReviewJob(job: ReviewJobView, signal?: AbortSignal, checkCancellation?: CancellationCheck): Promise<"processed" | "deferred"> {
    await ensureNotCanceled(signal, checkCancellation);
    console.log(`[worker] [review] Job claimed: id=${job.id}, kind=${job.kind}.`);
    if (job.runType && job.runId) {
      await this.recordEvent(
        { source: "worker", runType: job.runType, runId: job.runId, project: stringFromPayload(job.payload, "gitlabProjectId") ?? "unknown", sha: stringFromPayload(job.payload, "commitSha") ?? String(job.runId) },
        "info",
        "job_claimed",
        "Worker claimed queued review job.",
        { jobId: job.id, kind: job.kind, attempts: job.attempts }
      );
    }

    switch (job.kind) {
      case "commit_manual":
        return this.executeManualCommitJob(job, signal, checkCancellation);
      case "commit_retry":
        return this.executeCommitRetryJob(job, signal, checkCancellation);
      case "mr_retry":
        return this.executeMrRetryJob(job, signal, checkCancellation);
      case "commit_webhook":
        return this.executeWebhookCommitJob(job, signal, checkCancellation);
      case "mr_webhook":
        return this.executeWebhookMrJob(job, signal, checkCancellation);
      case "scan_user":
        await ensureNotCanceled(signal, checkCancellation);
        await this.scanOnce();
        return "processed";
      default:
        throw new Error(`Unknown review job kind: ${job.kind}`);
    }
  }

  private async executeWebhookCommitJob(job: ReviewJobView, signal?: AbortSignal, checkCancellation?: CancellationCheck): Promise<"processed" | "deferred"> {
    await ensureNotCanceled(signal, checkCancellation);
    const gitlabProjectRefId = numberFromPayload(job.payload, "gitlabProjectRefId");
    const commitSha = stringFromPayload(job.payload, "commitSha");
    if (!gitlabProjectRefId || !commitSha) throw new Error("Webhook commit review job payload is invalid");
    const branchName = stringFromPayload(job.payload, "branchName");
    const botConnection = await this.reviewerBot.getConnection();
    if (!botConnection) throw new Error("Reviewer bot token is not connected");
    const client = new GitLabClient(botConnection);
    const sharedProject = await this.state.getGitlabProject(gitlabProjectRefId);
    const projectLockKey = `project:${sharedProject.gitlabHost}:${sharedProject.gitlabProjectId}`;
    if (!(await this.state.acquireLock(projectLockKey))) {
      await this.requeueBusyJob(job, "Project review is already running.", checkCancellation);
      return "deferred";
    }
    try {
      const commit = await client.getCommit(sharedProject.gitlabProjectId, commitSha);
      const didReview = await this.reviewCommitShared(
        client,
        botConnection.accessToken,
        job.userId,
        null,
        sharedProject,
        branchName,
        commit,
        "auto",
        "worker",
        null,
        signal,
        checkCancellation
      );
      if (!didReview) {
        await this.requeueBusyJob(job, "Commit review lock is already held.", checkCancellation);
        return "deferred";
      }
      return "processed";
    } finally {
      await this.state.releaseLock(projectLockKey);
    }
  }

  private async executeWebhookMrJob(job: ReviewJobView, signal?: AbortSignal, checkCancellation?: CancellationCheck): Promise<"processed" | "deferred"> {
    await ensureNotCanceled(signal, checkCancellation);
    const gitlabProjectRefId = numberFromPayload(job.payload, "gitlabProjectRefId");
    const mrIid = numberFromPayload(job.payload, "mrIid");
    const headSha = stringFromPayload(job.payload, "headSha");
    if (!gitlabProjectRefId || !mrIid || !headSha) throw new Error("Webhook MR review job payload is invalid");
    const botConnection = await this.reviewerBot.getConnection();
    if (!botConnection) throw new Error("Reviewer bot token is not connected");
    const client = new GitLabClient(botConnection);
    const sharedProject = await this.state.getGitlabProject(gitlabProjectRefId);
    const projectLockKey = `project:${sharedProject.gitlabHost}:${sharedProject.gitlabProjectId}`;
    if (!(await this.state.acquireLock(projectLockKey))) {
      await this.requeueBusyJob(job, "Project review is already running.", checkCancellation);
      return "deferred";
    }
    try {
      const mrs = await client.listOpenedMergeRequests(sharedProject.gitlabProjectId);
      const mr = mrs.find((candidate) => candidate.iid === mrIid);
      if (!mr) throw new Error("Merge request is no longer opened");
      const representativeProjectId = numberFromPayload(job.payload, "projectId");
      if (!representativeProjectId) throw new Error("Webhook MR review job payload is missing representative project id");
      const didReview = await this.reviewMrShared(
        client,
        botConnection.accessToken,
        sharedProject,
        { id: representativeProjectId },
        mr,
        headSha,
        "worker",
        signal,
        checkCancellation
      );
      if (!didReview) {
        await this.requeueBusyJob(job, "MR review lock is already held.", checkCancellation);
        return "deferred";
      }
      return "processed";
    } finally {
      await this.state.releaseLock(projectLockKey);
    }
  }

  private async executeManualCommitJob(job: ReviewJobView, signal?: AbortSignal, checkCancellation?: CancellationCheck): Promise<"processed" | "deferred"> {
    await ensureNotCanceled(signal, checkCancellation);
    const gitlabProjectRefId = numberFromPayload(job.payload, "gitlabProjectRefId");
    const commitSha = stringFromPayload(job.payload, "commitSha");
    if (!gitlabProjectRefId || !commitSha) throw new Error("Manual commit review job payload is invalid");
    const branchName = stringFromPayload(job.payload, "branchName");
    const reviewStrategy = parseReviewStrategy(stringFromPayload(job.payload, "reviewStrategy"));
    const botConnection = await this.reviewerBot.getConnection();
    if (!botConnection) throw new Error("Reviewer bot token is not connected");
    const client = new GitLabClient(botConnection);
    const sharedProject = await this.state.getGitlabProject(gitlabProjectRefId);
    const projectLockKey = `project:${sharedProject.gitlabHost}:${sharedProject.gitlabProjectId}`;
    if (!(await this.state.acquireLock(projectLockKey))) {
      await this.requeueBusyJob(job, "Project review is already running.", checkCancellation);
      return "deferred";
    }
    try {
      const commit = await client.getCommit(sharedProject.gitlabProjectId, commitSha);
      const didReview = await this.reviewCommitShared(
        client,
        botConnection.accessToken,
        job.userId,
        null,
        sharedProject,
        branchName,
        commit,
        "manual",
        "worker",
        reviewStrategy,
        signal,
        checkCancellation
      );
      if (!didReview) {
        await this.requeueBusyJob(job, "Commit review lock is already held.", checkCancellation);
        return "deferred";
      }
      return "processed";
    } finally {
      await this.state.releaseLock(projectLockKey);
    }
  }

  private async executeCommitRetryJob(job: ReviewJobView, signal?: AbortSignal, checkCancellation?: CancellationCheck): Promise<"processed" | "deferred"> {
    await ensureNotCanceled(signal, checkCancellation);
    const runId = job.runId ?? numberFromPayload(job.payload, "runId");
    if (!runId) throw new Error("Commit retry job payload is invalid");
    const run = await this.state.getCommitRunById(job.userId, runId);
    if (!run) throw new Error("Commit review run not found");
    const botConnection = await this.reviewerBot.getConnection();
    if (!botConnection) throw new Error("Reviewer bot token is not connected");
    const client = new GitLabClient(botConnection);
    const commit = await client.getCommit(run.gitlabProjectId, run.commitSha);
    const trigger = run.trigger === "auto" ? "auto" : "manual";

    if (run.gitlabProjectRefId) {
      const sharedProject = await this.state.getGitlabProject(run.gitlabProjectRefId);
      const projectLockKey = `project:${sharedProject.gitlabHost}:${sharedProject.gitlabProjectId}`;
      if (!(await this.state.acquireLock(projectLockKey))) {
        await this.requeueBusyJob(job, "Project review is already running.", checkCancellation);
        return "deferred";
      }
      try {
        const didReview = await this.reviewCommitShared(
          client,
          botConnection.accessToken,
          job.userId,
          run.projectId,
          sharedProject,
          run.branchName,
          commit,
          trigger,
          "worker",
          run.reviewStrategyOverride,
          signal,
          checkCancellation
        );
        if (!didReview) {
          await this.requeueBusyJob(job, "Commit review lock is already held.", checkCancellation);
          return "deferred";
        }
        return "processed";
      } finally {
        await this.state.releaseLock(projectLockKey);
      }
    }

    const project = run.projectId ? await this.state.getProject(job.userId, run.projectId).catch(() => null) : null;
    const didReview = await this.reviewCommit(client, job.userId, project, run.gitlabProjectId, run.branchName, commit, trigger, "worker", signal, checkCancellation);
    if (!didReview) {
      await this.requeueBusyJob(job, "Commit review lock is already held.", checkCancellation);
      return "deferred";
    }
    return "processed";
  }

  private async executeMrRetryJob(job: ReviewJobView, signal?: AbortSignal, checkCancellation?: CancellationCheck): Promise<"processed" | "deferred"> {
    await ensureNotCanceled(signal, checkCancellation);
    const runId = job.runId ?? numberFromPayload(job.payload, "runId");
    if (!runId) throw new Error("MR retry job payload is invalid");
    const run = await this.state.getRunById(job.userId, runId);
    if (!run) throw new Error("Review run not found");
    const botConnection = await this.reviewerBot.getConnection();
    if (!botConnection) throw new Error("Reviewer bot token is not connected");
    const client = new GitLabClient(botConnection);

    if (!run.gitlabProjectRefId) {
      await this.reviewByCoordinates(client, job.userId, run.projectId, run.gitlabProjectId, run.displayName, run.mrIid, run.headSha, "worker", signal, checkCancellation);
      return "processed";
    }

    const sharedProject = await this.state.getGitlabProject(run.gitlabProjectRefId);
    const projectLockKey = `project:${sharedProject.gitlabHost}:${sharedProject.gitlabProjectId}`;
    if (!(await this.state.acquireLock(projectLockKey))) {
      await this.requeueBusyJob(job, "Project review is already running.", checkCancellation);
      return "deferred";
    }
    try {
      const mrs = await client.listOpenedMergeRequests(sharedProject.gitlabProjectId);
      const mr = mrs.find((candidate) => candidate.iid === run.mrIid);
      if (!mr) throw new Error("Merge request is no longer opened");
      const didReview = await this.reviewMrShared(client, botConnection.accessToken, sharedProject, { id: run.projectId }, mr, run.headSha, "worker", signal, checkCancellation);
      if (!didReview) {
        await this.requeueBusyJob(job, "MR review lock is already held.", checkCancellation);
        return "deferred";
      }
      return "processed";
    } finally {
      await this.state.releaseLock(projectLockKey);
    }
  }

  private async requeueBusyJob(job: ReviewJobView, message: string, checkCancellation?: CancellationCheck): Promise<void> {
    await ensureNotCanceled(undefined, checkCancellation);
    await this.state.requeueReviewJob(job.id, message);
    await ensureNotCanceled(undefined, checkCancellation);
    if (job.runType && job.runId) {
      await this.recordEvent(
        { source: "worker", runType: job.runType, runId: job.runId, project: stringFromPayload(job.payload, "gitlabProjectId") ?? "unknown", sha: stringFromPayload(job.payload, "commitSha") ?? String(job.runId) },
        "warn",
        "job_deferred",
        `${message} Worker will retry later.`,
        { jobId: job.id, kind: job.kind }
      );
    }
  }

  private async ensureSharedProjectMetadata(client: GitLabClient, group: SharedProjectGroup): Promise<SharedProjectGroup> {
    if (group.gitlabProject.cloneHttpUrl && group.gitlabProject.pathWithNamespace) return group;
    const project = await client.getProject(group.gitlabProject.gitlabProjectId);
    const updated = await this.state.upsertGitlabProject({
      gitlabHost: group.gitlabProject.gitlabHost,
      gitlabProjectId: String(project.id),
      pathWithNamespace: project.path_with_namespace,
      nameWithNamespace: project.name_with_namespace,
      webUrl: project.web_url ?? null,
      cloneHttpUrl: project.http_url_to_repo ?? null,
      defaultBranch: project.default_branch ?? null
    });
    return { ...group, gitlabProject: updated };
  }

  private async scanMergeRequestsForGroup(
    client: GitLabClient,
    botToken: string,
    group: SharedProjectGroup
  ): Promise<ScanSummary> {
    let reviewed = 0;
    let skipped = 0;
    let errors = 0;
    let mrs: GitLabMergeRequest[];

    try {
      mrs = await this.listMergeRequestsForGroup(client, group);
    } catch {
      return { reviewed, skipped, errors: errors + 1 };
    }

    for (const mr of mrs) {
      await this.state.upsertMergeRequestShared(group.gitlabProject.id, group.representative.id, mr);
      if (this.shouldSkipGroup(group, mr)) {
        skipped += 1;
        continue;
      }
      if (!mr.sha) {
        skipped += 1;
        continue;
      }
      if (await this.state.hasCompletedSharedRun(group.gitlabProject.id, mr.iid, mr.sha)) {
        skipped += 1;
        continue;
      }

      try {
        const didReview = await this.reviewMrShared(client, botToken, group.gitlabProject, group.representative, mr, mr.sha, "worker");
        if (didReview) reviewed += 1;
      } catch {
        errors += 1;
      }
    }

    return { reviewed, skipped, errors };
  }

  private async listMergeRequestsForGroup(client: GitLabClient, group: SharedProjectGroup): Promise<GitLabMergeRequest[]> {
    if (!group.mrTargetBranches.length) return [];

    const byIid = new Map<number, GitLabMergeRequest>();
    for (const branch of uniqueNonEmpty(group.mrTargetBranches)) {
      const mrs = await client.listOpenedMergeRequests(group.gitlabProject.gitlabProjectId, branch);
      for (const mr of mrs) byIid.set(mr.iid, mr);
    }
    return [...byIid.values()];
  }

  private async scanCommitBranchesForGroup(
    client: GitLabClient,
    botToken: string,
    group: SharedProjectGroup
  ): Promise<ScanSummary> {
    let reviewed = 0;
    let skipped = 0;
    let errors = 0;

    for (const branchName of uniqueNonEmpty(group.commitBranches)) {
      let latest: GitLabCommit | null;
      try {
        latest = await client.getLatestCommit(group.gitlabProject.gitlabProjectId, branchName);
      } catch (error) {
        const currentState = await this.state.getSharedBranchWatchState(group.gitlabProject.id, branchName);
        await this.state.setSharedBranchWatchState(
          group.gitlabProject.id,
          group.representative.id,
          branchName,
          currentState?.lastSeenSha ?? null,
          errorMessage(error)
        );
        errors += 1;
        continue;
      }

      if (!latest?.id) {
        skipped += 1;
        continue;
      }

      const watchState = await this.state.getSharedBranchWatchState(group.gitlabProject.id, branchName);
      if (!watchState?.lastSeenSha) {
        await this.state.setSharedBranchWatchState(group.gitlabProject.id, group.representative.id, branchName, latest.id, null);
        skipped += 1;
        continue;
      }

      if (watchState.lastSeenSha === latest.id) {
        skipped += 1;
        continue;
      }

      let commits: GitLabCommit[];
      try {
        commits = await client.compareCommits(group.gitlabProject.gitlabProjectId, watchState.lastSeenSha, latest.id);
      } catch (error) {
        await this.state.setSharedBranchWatchState(group.gitlabProject.id, group.representative.id, branchName, latest.id, errorMessage(error));
        errors += 1;
        continue;
      }

      const orderedCommits = orderCommitsOldestFirst(commits.filter((commit) => Boolean(commit.id)));
      if (!orderedCommits.length) skipped += 1;

      for (const commit of orderedCommits) {
        if (await this.state.hasCompletedSharedCommitRun(group.gitlabProject.id, commit.id)) {
          skipped += 1;
          continue;
        }

        try {
          const didReview = await this.reviewCommitShared(
            client,
            botToken,
            group.representative.userId,
            group.representative.id,
            group.gitlabProject,
            branchName,
            commit,
            "auto",
            "worker"
          );
          if (didReview) reviewed += 1;
        } catch {
          errors += 1;
        }
      }

      await this.state.setSharedBranchWatchState(group.gitlabProject.id, group.representative.id, branchName, latest.id, null);
    }

    return { reviewed, skipped, errors };
  }

  private async scanMergeRequestsForProject(client: GitLabClient, project: ProjectRow): Promise<ScanSummary> {
    let reviewed = 0;
    let skipped = 0;
    let errors = 0;
    let mrs: GitLabMergeRequest[];

    try {
      mrs = await this.listMergeRequestsForProject(client, project);
    } catch {
      return { reviewed, skipped, errors: errors + 1 };
    }

    for (const mr of mrs) {
      await this.state.upsertMergeRequest(project.id, mr);
      if (this.shouldSkip(project, mr)) {
        skipped += 1;
        continue;
      }
      if (!mr.sha) {
        skipped += 1;
        continue;
      }
      if (await this.state.hasCompletedRun(project.id, mr.iid, mr.sha)) {
        skipped += 1;
        continue;
      }

      try {
        const didReview = await this.reviewMr(client, project, mr, mr.sha, "worker");
        if (didReview) reviewed += 1;
      } catch {
        errors += 1;
      }
    }

    return { reviewed, skipped, errors };
  }

  private async listMergeRequestsForProject(client: GitLabClient, project: ProjectRow): Promise<GitLabMergeRequest[]> {
    const targetBranches = uniqueNonEmpty(project.mrTargetBranches);
    if (!targetBranches.length) return [];

    const byIid = new Map<number, GitLabMergeRequest>();
    for (const branch of targetBranches) {
      const mrs = await client.listOpenedMergeRequests(project.gitlabProjectId, branch);
      for (const mr of mrs) byIid.set(mr.iid, mr);
    }
    return [...byIid.values()];
  }

  private async scanCommitBranchesForProject(
    client: GitLabClient,
    userId: number,
    project: ProjectRow
  ): Promise<ScanSummary> {
    let reviewed = 0;
    let skipped = 0;
    let errors = 0;

    for (const branchName of uniqueNonEmpty(project.commitBranches)) {
      let latest: GitLabCommit | null;
      try {
        latest = await client.getLatestCommit(project.gitlabProjectId, branchName);
      } catch (error) {
        const currentState = await this.state.getBranchWatchState(project.id, branchName);
        await this.state.setBranchWatchState(project.id, branchName, currentState?.lastSeenSha ?? null, errorMessage(error));
        errors += 1;
        continue;
      }

      if (!latest?.id) {
        skipped += 1;
        continue;
      }

      const watchState = await this.state.getBranchWatchState(project.id, branchName);
      if (!watchState?.lastSeenSha) {
        await this.state.setBranchWatchState(project.id, branchName, latest.id, null);
        skipped += 1;
        continue;
      }

      if (watchState.lastSeenSha === latest.id) {
        skipped += 1;
        continue;
      }

      let commits: GitLabCommit[];
      try {
        commits = await client.compareCommits(project.gitlabProjectId, watchState.lastSeenSha, latest.id);
      } catch (error) {
        await this.state.setBranchWatchState(project.id, branchName, latest.id, errorMessage(error));
        errors += 1;
        continue;
      }

      const orderedCommits = orderCommitsOldestFirst(commits.filter((commit) => Boolean(commit.id)));
      if (!orderedCommits.length) {
        skipped += 1;
      }

      for (const commit of orderedCommits) {
        if (await this.state.hasCompletedCommitRun(userId, project.gitlabProjectId, commit.id)) {
          skipped += 1;
          continue;
        }

        try {
          const didReview = await this.reviewCommit(client, userId, project, project.gitlabProjectId, branchName, commit, "auto", "worker");
          if (didReview) reviewed += 1;
        } catch {
          errors += 1;
        }
      }

      await this.state.setBranchWatchState(project.id, branchName, latest.id, null);
    }

    return { reviewed, skipped, errors };
  }

  private async reviewByCoordinates(
    client: GitLabClient,
    userId: number,
    projectDbId: number,
    gitlabProjectId: string,
    displayName: string,
    mrIid: number,
    headSha: string,
    source: ReviewLogSource,
    signal?: AbortSignal,
    checkCancellation?: CancellationCheck
  ): Promise<void> {
    await ensureNotCanceled(signal, checkCancellation);
    const mrs = await client.listOpenedMergeRequests(gitlabProjectId);
    const mr = mrs.find((candidate) => candidate.iid === mrIid);
    if (!mr) throw new Error("Merge request is no longer opened");
    await this.reviewMr(
      client,
      {
        id: projectDbId,
        userId,
        gitlabProjectRefId: null,
        gitlabProjectId,
        displayName,
        webUrl: null,
        enabled: true,
        skipLabels: [],
        mrTargetBranches: [],
        commitBranches: [],
        reviewStrategy: "balanced",
        reviewStrategyUpdatedByUserId: null,
        reviewStrategyUpdatedAt: null,
        reviewProfile: "assertive",
        pathFilters: defaultPathFilters(),
        webhookStatus: "missing",
        webhookUrl: null,
        webhookLastVerifiedAt: null,
        webhookError: null
      },
      mr,
      headSha,
      source,
      signal,
      checkCancellation
    );
  }

  private async reviewMr(
    client: GitLabClient,
    project: ProjectRow,
    mr: GitLabMergeRequest,
    headSha: string,
    source: ReviewLogSource,
    signal?: AbortSignal,
    checkCancellation?: CancellationCheck
  ): Promise<boolean> {
    await ensureNotCanceled(signal, checkCancellation);
    const lockKey = `${project.id}:${mr.iid}:${headSha}`;
    if (!(await this.state.acquireLock(lockKey))) return false;
    const runId = await this.state.startRun(project.id, mr.iid, headSha);
    const context: EventContext = { source, runType: "mr", runId, project: project.gitlabProjectId, sha: headSha };

    try {
      await this.recordEvent(context, "info", "run_started", "MR review run started.", { mrIid: mr.iid, projectDbId: project.id });
      await this.recordEvent(context, "info", "lock_acquired", "Review lock acquired.");
      await ensureNotCanceled(signal, checkCancellation);
      const diffs = await client.listMergeRequestDiffs(project.gitlabProjectId, mr.iid);
      const reviewConfig = await this.loadProjectReviewConfig(context, project, diffs);
      const reviewableDiffs = filterDiffsForReview(diffs, reviewConfig.pathFilters);
      const formatted = formatDiffForReview(project.displayName, mr, reviewableDiffs, this.config.maxDiffBytes);
      await this.recordEvent(context, "info", "diff_fetched", "GitLab MR diff fetched.", {
        diffFileCount: diffs.length,
        reviewableFileCount: reviewableDiffs.length,
        truncated: formatted.truncated,
        omittedFiles: formatted.omittedFiles
      });
      const reviewInput = await this.enhanceReviewInput(
        context,
        buildMrReviewInput(project.displayName, mr, headSha, formatted.text, null),
        reviewConfig,
        reviewableDiffs,
        null
      );
      const { runtimeSettings, resolution } = await this.resolveRuntimeSettings(context, project.reviewStrategy, reviewInput, formatted, reviewableDiffs, signal);
      await this.recordEvent(context, "info", "codex_started", "Codex review started.", codexStartMetadata(runtimeSettings, resolution, this.config.codexSandboxMode));
      const result = await this.reviewer.review(
        reviewInput,
        (event) => this.recordEvent(context, event.level, event.step, event.message, event.metadata),
        runtimeSettings,
        { signal }
      );
      await ensureNotCanceled(signal, checkCancellation);
      await this.recordEvent(context, "info", "codex_finished", "Codex review finished.", {
        hasFindings: result.hasFindings,
        responseBytes: Buffer.byteLength(result.raw, "utf8"),
        assessment: result.structured.assessment,
        shouldPostComment: result.structured.shouldPostComment
      });
      if (!result.hasFindings) {
        await ensureNotCanceled(signal, checkCancellation);
        const comment = await publishReviewNote(client, project.gitlabProjectId, mr.iid, headSha, result.markdown, mr.web_url);
        await this.state.finishNoFindings(runId, result.markdown, comment, result.structured);
        await this.recordEvent(context, "info", "no_findings", "Codex completed with no actionable findings; summary comment was posted to GitLab.");
        await this.recordEvent(context, "info", "comment_posted", "GitLab MR review summary comment posted.", {
          commentId: comment.id,
          skippedExistingComment: comment.skipped
        });
        await this.recordEvent(context, "info", "run_finished", "MR review run finished.", { finalStatus: "no_findings" });
        return true;
      }

      await ensureNotCanceled(signal, checkCancellation);
      await this.publishInlineReviewComments(context, client, project.gitlabProjectId, mr, headSha, reviewableDiffs, [
        ...result.structured.criticalIssues,
        ...result.structured.potentialIssues
      ]);
      await ensureNotCanceled(signal, checkCancellation);
      const comment = await publishReviewNote(client, project.gitlabProjectId, mr.iid, headSha, result.markdown, mr.web_url);
      await this.state.finishCommented(runId, comment, result.markdown, result.structured);
      await this.recordEvent(context, "info", "comment_posted", "GitLab MR review comment posted.", {
        commentId: comment.id,
        skippedExistingComment: comment.skipped
      });
      await this.recordEvent(context, "info", "run_finished", "MR review run finished.", { finalStatus: "commented" });
      return true;
    } catch (error) {
      if (isCancellationError(error, signal)) throw error;
      await this.state.failRun(runId, error);
      await this.recordEvent(context, "error", "run_failed", "MR review run failed.", { error: errorMessage(error) });
      throw error;
    } finally {
      await this.state.releaseLock(lockKey);
    }
  }

  private async reviewMrShared(
    client: GitLabClient,
    botToken: string,
    gitlabProject: GitlabProjectRow,
    representative: Pick<ProjectRow, "id">,
    mr: GitLabMergeRequest,
    headSha: string,
    source: ReviewLogSource,
    signal?: AbortSignal,
    checkCancellation?: CancellationCheck
  ): Promise<boolean> {
    await ensureNotCanceled(signal, checkCancellation);
    const lockKey = `mr:${gitlabProject.id}:${mr.iid}:${headSha}`;
    if (!(await this.state.acquireLock(lockKey))) return false;
    const runId = await this.state.startSharedRun(gitlabProject.id, representative.id, mr.iid, headSha);
    const context: EventContext = { source, runType: "mr", runId, project: gitlabProject.gitlabProjectId, sha: headSha };

    try {
      await this.recordEvent(context, "info", "run_started", "MR review run started.", { mrIid: mr.iid, sharedProjectId: gitlabProject.id });
      await this.recordEvent(context, "info", "bot_token_loaded", "Reviewer bot token loaded for GitLab review actions.");
      await this.recordEvent(context, "info", "gitlab_project_resolved", "GitLab project metadata resolved.", {
        pathWithNamespace: gitlabProject.pathWithNamespace,
        defaultBranch: gitlabProject.defaultBranch
      });
      await this.recordEvent(context, "info", "lock_acquired", "Review lock acquired.");
      await ensureNotCanceled(signal, checkCancellation);
      const diffs = await client.listMergeRequestDiffs(gitlabProject.gitlabProjectId, mr.iid);
      const reviewConfig = await this.loadSharedReviewConfig(context, gitlabProject.id, diffs);
      const reviewableDiffs = filterDiffsForReview(diffs, reviewConfig.pathFilters);
      const formatted = formatDiffForReview(projectDisplayName(gitlabProject), mr, reviewableDiffs, this.config.maxDiffBytes);
      await this.recordEvent(context, "info", "diff_fetched", "GitLab MR diff fetched.", {
        diffFileCount: diffs.length,
        reviewableFileCount: reviewableDiffs.length,
        truncated: formatted.truncated,
        omittedFiles: formatted.omittedFiles
      });
      const checkout = await this.checkoutWorkspace(context, gitlabProject, botToken, headSha);
      const reviewInput = await this.enhanceReviewInput(
        context,
        buildMrReviewInput(projectDisplayName(gitlabProject), mr, headSha, formatted.text, checkout.path),
        reviewConfig,
        reviewableDiffs,
        checkout.path
      );
      const { runtimeSettings, resolution } = await this.resolveRuntimeSettings(context, gitlabProject.reviewStrategy, reviewInput, formatted, reviewableDiffs, signal);
      await this.recordEvent(context, "info", "codex_started", "Codex review started.", codexStartMetadata(runtimeSettings, resolution, this.config.codexSandboxMode));
      const result = await this.reviewer.review(
        reviewInput,
        (event) => this.recordEvent(context, event.level, event.step, event.message, event.metadata),
        runtimeSettings,
        { signal }
      );
      await ensureNotCanceled(signal, checkCancellation);
      await this.recordEvent(context, "info", "codex_finished", "Codex review finished.", {
        hasFindings: result.hasFindings,
        responseBytes: Buffer.byteLength(result.raw, "utf8"),
        assessment: result.structured.assessment,
        shouldPostComment: result.structured.shouldPostComment
      });
      if (!result.hasFindings) {
        await ensureNotCanceled(signal, checkCancellation);
        const comment = await publishReviewNote(client, gitlabProject.gitlabProjectId, mr.iid, headSha, result.markdown, mr.web_url);
        await this.state.finishNoFindings(runId, result.markdown, comment, result.structured);
        await this.recordEvent(context, "info", "no_findings", "Codex completed with no actionable findings; summary comment was posted to GitLab.");
        await this.recordEvent(context, "info", "comment_posted", "GitLab MR review summary comment posted.", {
          commentId: comment.id,
          skippedExistingComment: comment.skipped
        });
        await this.recordEvent(context, "info", "run_finished", "MR review run finished.", { finalStatus: "no_findings" });
        return true;
      }

      await ensureNotCanceled(signal, checkCancellation);
      await this.publishInlineReviewComments(context, client, gitlabProject.gitlabProjectId, mr, headSha, reviewableDiffs, [
        ...result.structured.criticalIssues,
        ...result.structured.potentialIssues
      ]);
      await ensureNotCanceled(signal, checkCancellation);
      const comment = await publishReviewNote(client, gitlabProject.gitlabProjectId, mr.iid, headSha, result.markdown, mr.web_url);
      await this.state.finishCommented(runId, comment, result.markdown, result.structured);
      await this.recordEvent(context, "info", "comment_posted", "GitLab MR review comment posted.", {
        commentId: comment.id,
        skippedExistingComment: comment.skipped
      });
      await this.recordEvent(context, "info", "run_finished", "MR review run finished.", { finalStatus: "commented" });
      return true;
    } catch (error) {
      if (isCancellationError(error, signal)) throw error;
      await this.state.failRun(runId, error);
      await this.recordEvent(context, "error", "run_failed", "MR review run failed.", { error: errorMessage(error) });
      throw error;
    } finally {
      await this.state.releaseLock(lockKey);
    }
  }


  private async reviewCommit(
    client: GitLabClient,
    userId: number,
    project: ProjectRow | null,
    gitlabProjectId: string,
    branchName: string | null,
    commit: GitLabCommit,
    trigger: CommitReviewTrigger,
    source: ReviewLogSource,
    signal?: AbortSignal,
    checkCancellation?: CancellationCheck
  ): Promise<boolean> {
    await ensureNotCanceled(signal, checkCancellation);
    const lockKey = `commit:${userId}:${gitlabProjectId}:${commit.id}`;
    if (!(await this.state.acquireLock(lockKey))) return false;
    const runId = await this.state.startCommitRun(userId, project?.id ?? null, gitlabProjectId, branchName, commit, trigger);
    const context: EventContext = { source, runType: "commit", runId, project: gitlabProjectId, sha: commit.id };

    try {
      await this.recordEvent(context, "info", "run_started", "Commit review run started.", { branchName, trigger, projectDbId: project?.id ?? null });
      await this.recordEvent(context, "info", "lock_acquired", "Review lock acquired.");
      await ensureNotCanceled(signal, checkCancellation);
      const diffs = await client.listCommitDiffs(gitlabProjectId, commit.id);
      const reviewConfig = await this.loadProjectReviewConfig(context, project, diffs);
      const reviewableDiffs = filterDiffsForReview(diffs, reviewConfig.pathFilters);
      const formatted = formatCommitDiffForReview(project?.displayName ?? gitlabProjectId, commit, branchName, reviewableDiffs, this.config.maxDiffBytes);
      await this.recordEvent(context, "info", "diff_fetched", "GitLab commit diff fetched.", {
        diffFileCount: diffs.length,
        reviewableFileCount: reviewableDiffs.length,
        truncated: formatted.truncated,
        omittedFiles: formatted.omittedFiles
      });
      const reviewInput = await this.enhanceReviewInput(
        context,
        buildCommitReviewInput(project?.displayName ?? gitlabProjectId, commit, branchName, formatted.text, null),
        reviewConfig,
        reviewableDiffs,
        null
      );
      const { runtimeSettings, resolution } = await this.resolveRuntimeSettings(context, project?.reviewStrategy ?? "balanced", reviewInput, formatted, reviewableDiffs, signal);
      await this.recordEvent(context, "info", "codex_started", "Codex review started.", codexStartMetadata(runtimeSettings, resolution, this.config.codexSandboxMode));
      const result = await this.reviewer.review(
        reviewInput,
        (event) => this.recordEvent(context, event.level, event.step, event.message, event.metadata),
        runtimeSettings,
        { signal }
      );
      await ensureNotCanceled(signal, checkCancellation);
      await this.recordEvent(context, "info", "codex_finished", "Codex review finished.", {
        hasFindings: result.hasFindings,
        responseBytes: Buffer.byteLength(result.raw, "utf8"),
        assessment: result.structured.assessment,
        shouldPostComment: result.structured.shouldPostComment
      });
      if (!result.hasFindings) {
        await ensureNotCanceled(signal, checkCancellation);
        const comment = await publishCommitReviewNote(client, gitlabProjectId, commit.id, result.markdown, commit.web_url);
        await this.state.finishCommitNoFindings(runId, result.markdown, comment, result.structured);
        await this.recordEvent(context, "info", "no_findings", "Codex completed with no actionable findings; summary comment was posted to GitLab.");
        await this.recordEvent(context, "info", "comment_posted", "GitLab commit review summary comment posted.", {
          commentId: comment.id,
          skippedExistingComment: comment.skipped
        });
        await this.recordEvent(context, "info", "run_finished", "Commit review run finished.", { finalStatus: "no_findings" });
        return true;
      }

      await ensureNotCanceled(signal, checkCancellation);
      const comment = await publishCommitReviewNote(client, gitlabProjectId, commit.id, result.markdown, commit.web_url);
      await this.state.finishCommitCommented(runId, comment, result.markdown, result.structured);
      await this.recordEvent(context, "info", "comment_posted", "GitLab commit review comment posted.", {
        commentId: comment.id,
        skippedExistingComment: comment.skipped
      });
      await this.recordEvent(context, "info", "run_finished", "Commit review run finished.", { finalStatus: "commented" });
      return true;
    } catch (error) {
      if (isCancellationError(error, signal)) throw error;
      await this.state.failCommitRun(runId, error);
      await this.recordEvent(context, "error", "run_failed", "Commit review run failed.", { error: errorMessage(error) });
      throw error;
    } finally {
      await this.state.releaseLock(lockKey);
    }
  }

  private async reviewCommitShared(
    client: GitLabClient,
    botToken: string,
    representativeUserId: number,
    representativeProjectId: number | null,
    gitlabProject: GitlabProjectRow,
    branchName: string | null,
    commit: GitLabCommit,
    trigger: CommitReviewTrigger,
    source: ReviewLogSource,
    reviewStrategyOverride: ReviewStrategy | null = null,
    signal?: AbortSignal,
    checkCancellation?: CancellationCheck
  ): Promise<boolean> {
    await ensureNotCanceled(signal, checkCancellation);
    const lockKey = `commit:${gitlabProject.id}:${commit.id}`;
    if (!(await this.state.acquireLock(lockKey))) return false;
    const runId = await this.state.startSharedCommitRun(
      representativeUserId,
      representativeProjectId,
      gitlabProject.id,
      gitlabProject.gitlabProjectId,
      branchName,
      commit,
      trigger,
      "running",
      reviewStrategyOverride
    );
    const context: EventContext = { source, runType: "commit", runId, project: gitlabProject.gitlabProjectId, sha: commit.id };

    try {
      await this.recordEvent(context, "info", "run_started", "Commit review run started.", {
        branchName,
        trigger,
        reviewStrategy: reviewStrategyOverride ?? gitlabProject.reviewStrategy,
        sharedProjectId: gitlabProject.id
      });
      await this.recordEvent(context, "info", "bot_token_loaded", "Reviewer bot token loaded for GitLab review actions.");
      await this.recordEvent(context, "info", "gitlab_project_resolved", "GitLab project metadata resolved.", {
        pathWithNamespace: gitlabProject.pathWithNamespace,
        defaultBranch: gitlabProject.defaultBranch
      });
      await this.recordEvent(context, "info", "lock_acquired", "Review lock acquired.");
      await ensureNotCanceled(signal, checkCancellation);
      const diffs = await client.listCommitDiffs(gitlabProject.gitlabProjectId, commit.id);
      const reviewConfig = await this.loadSharedReviewConfig(context, gitlabProject.id, diffs);
      const reviewableDiffs = filterDiffsForReview(diffs, reviewConfig.pathFilters);
      const formatted = formatCommitDiffForReview(projectDisplayName(gitlabProject), commit, branchName, reviewableDiffs, this.config.maxDiffBytes);
      await this.recordEvent(context, "info", "diff_fetched", "GitLab commit diff fetched.", {
        diffFileCount: diffs.length,
        reviewableFileCount: reviewableDiffs.length,
        truncated: formatted.truncated,
        omittedFiles: formatted.omittedFiles
      });
      const checkout = await this.checkoutWorkspace(context, gitlabProject, botToken, commit.id);
      const reviewInput = await this.enhanceReviewInput(
        context,
        buildCommitReviewInput(projectDisplayName(gitlabProject), commit, branchName, formatted.text, checkout.path),
        reviewConfig,
        reviewableDiffs,
        checkout.path
      );
      const selectedStrategy = reviewStrategyOverride ?? gitlabProject.reviewStrategy;
      const { runtimeSettings, resolution } = await this.resolveRuntimeSettings(context, selectedStrategy, reviewInput, formatted, reviewableDiffs, signal);
      await this.recordEvent(context, "info", "codex_started", "Codex review started.", codexStartMetadata(runtimeSettings, resolution, this.config.codexSandboxMode));
      const result = await this.reviewer.review(
        reviewInput,
        (event) => this.recordEvent(context, event.level, event.step, event.message, event.metadata),
        runtimeSettings,
        { signal }
      );
      await ensureNotCanceled(signal, checkCancellation);
      await this.recordEvent(context, "info", "codex_finished", "Codex review finished.", {
        hasFindings: result.hasFindings,
        responseBytes: Buffer.byteLength(result.raw, "utf8"),
        assessment: result.structured.assessment,
        shouldPostComment: result.structured.shouldPostComment
      });
      if (!result.hasFindings) {
        await ensureNotCanceled(signal, checkCancellation);
        const comment = await publishCommitReviewNote(client, gitlabProject.gitlabProjectId, commit.id, result.markdown, commit.web_url);
        await this.state.finishCommitNoFindings(runId, result.markdown, comment, result.structured);
        await this.recordEvent(context, "info", "no_findings", "Codex completed with no actionable findings; summary comment was posted to GitLab.");
        await this.recordEvent(context, "info", "comment_posted", "GitLab commit review summary comment posted.", {
          commentId: comment.id,
          skippedExistingComment: comment.skipped
        });
        await this.recordEvent(context, "info", "run_finished", "Commit review run finished.", { finalStatus: "no_findings" });
        return true;
      }

      await ensureNotCanceled(signal, checkCancellation);
      const comment = await publishCommitReviewNote(client, gitlabProject.gitlabProjectId, commit.id, result.markdown, commit.web_url);
      await this.state.finishCommitCommented(runId, comment, result.markdown, result.structured);
      await this.recordEvent(context, "info", "comment_posted", "GitLab commit review comment posted.", {
        commentId: comment.id,
        skippedExistingComment: comment.skipped
      });
      await this.recordEvent(context, "info", "run_finished", "Commit review run finished.", { finalStatus: "commented" });
      return true;
    } catch (error) {
      if (isCancellationError(error, signal)) throw error;
      await this.state.failCommitRun(runId, error);
      await this.recordEvent(context, "error", "run_failed", "Commit review run failed.", { error: errorMessage(error) });
      throw error;
    } finally {
      await this.state.releaseLock(lockKey);
    }
  }

  private async loadSharedReviewConfig(context: EventContext, gitlabProjectRefId: number, diffs: GitLabDiff[]): Promise<ProjectReviewConfig> {
    const config = await this.state.getSharedProjectReviewConfig(gitlabProjectRefId);
    const changedFiles = changedFilesFromDiffs(diffs);
    const matchedInstructions = matchReviewInstructions(config.instructions, changedFiles, config.pathFilters);
    const reviewableFiles = filterChangedFiles(changedFiles, config.pathFilters);
    await this.recordEvent(context, "info", "project_instructions_loaded", "Project review instructions loaded.", {
      reviewProfile: config.reviewProfile,
      pathFilterCount: config.pathFilters.length,
      instructionCount: config.instructions.length,
      matchedInstructionCount: matchedInstructions.length,
      changedFileCount: changedFiles.length,
      reviewableFileCount: reviewableFiles.length
    });
    return config;
  }

  private async loadProjectReviewConfig(context: EventContext, project: ProjectRow | null, diffs: GitLabDiff[]): Promise<ProjectReviewConfig> {
    const config = project?.gitlabProjectRefId
      ? await this.state.getSharedProjectReviewConfig(project.gitlabProjectRefId)
      : {
          reviewProfile: "assertive" as const,
          pathFilters: defaultPathFilters(),
          instructions: []
        };
    const changedFiles = changedFilesFromDiffs(diffs);
    const matchedInstructions = matchReviewInstructions(config.instructions, changedFiles, config.pathFilters);
    const reviewableFiles = filterChangedFiles(changedFiles, config.pathFilters);
    await this.recordEvent(context, "info", "project_instructions_loaded", "Project review instructions loaded.", {
      reviewProfile: config.reviewProfile,
      pathFilterCount: config.pathFilters.length,
      instructionCount: config.instructions.length,
      matchedInstructionCount: matchedInstructions.length,
      changedFileCount: changedFiles.length,
      reviewableFileCount: reviewableFiles.length
    });
    return config;
  }

  private async enhanceReviewInput(
    context: EventContext,
    input: ReviewPromptInput,
    config: ProjectReviewConfig,
    diffs: GitLabDiff[],
    workingDirectory: string | null
  ): Promise<ReviewPromptInput> {
    const changedFiles = filterChangedFiles(changedFilesFromDiffs(diffs), config.pathFilters);
    const matchedInstructions = matchReviewInstructions(config.instructions, changedFiles, config.pathFilters);
    const toolFindings = workingDirectory
      ? await this.runReadonlyTools(context, workingDirectory, changedFiles)
      : [];
    return {
      ...input,
      changedFiles,
      pathFilters: config.pathFilters,
      matchedInstructions,
      toolFindings,
      reviewProfile: config.reviewProfile
    };
  }

  private async runReadonlyTools(context: EventContext, workingDirectory: string, changedFiles: string[]): Promise<PromptToolFinding[]> {
    await this.recordEvent(context, "info", "tool_runner_started", "Read-only static analysis started.", {
      toolCount: 4,
      changedFileCount: changedFiles.length
    });
    try {
      const events = await this.toolRunner.run({ workingDirectory, changedFiles });
      for (const event of events) {
        await this.recordToolRunnerEvent(context, event);
      }
      return events.flatMap((event) => event.findings).slice(0, 50);
    } catch (error) {
      await this.recordEvent(context, "warn", "tool_runner_failed", "Read-only static analysis failed.", {
        error: errorMessage(error)
      });
      return [];
    }
  }

  private async recordToolRunnerEvent(context: EventContext, event: ToolRunnerEvent): Promise<void> {
    await this.recordEvent(
      context,
      event.status === "failed" ? "warn" : "info",
      event.status === "failed" ? "tool_runner_failed" : "tool_runner_result",
      event.summary,
      {
        tool: event.tool,
        status: event.status,
        findingCount: event.findings.length,
        durationMs: event.durationMs,
        outputBytes: event.outputBytes,
        outputPreview: event.outputPreview,
        outputTruncated: event.outputTruncated,
        findings: event.findings.slice(0, 10)
      }
    );
  }

  private async publishInlineReviewComments(
    context: EventContext,
    client: GitLabClient,
    gitlabProjectId: string,
    mr: GitLabMergeRequest,
    headSha: string,
    diffs: GitLabDiff[],
    issues: ReviewIssue[]
  ): Promise<void> {
    const inlineIssues = issues.filter((issue) => issue.file && issue.line).length;
    if (!inlineIssues) return;
    try {
      const detailedMr = mr.diff_refs ? mr : await client.getMergeRequest(gitlabProjectId, mr.iid);
      const results = await publishMergeRequestInlineComments(client, gitlabProjectId, mr.iid, headSha, detailedMr, diffs, issues);
      for (const result of results) {
        await this.recordEvent(
          context,
          result.status === "posted" || result.status === "skipped_existing" ? "info" : "warn",
          result.status === "posted" || result.status === "skipped_existing" ? "inline_comment_posted" : "inline_comment_failed",
          result.status === "posted"
            ? "GitLab inline review comment posted."
            : result.status === "skipped_existing"
              ? "GitLab inline review comment already existed."
              : "GitLab inline review comment could not be posted.",
          result
        );
      }
    } catch (error) {
      await this.recordEvent(context, "warn", "inline_comment_failed", "GitLab inline review comments failed.", {
        error: errorMessage(error),
        issueCount: inlineIssues
      });
    }
  }

  private async resolveRuntimeSettings(
    context: EventContext,
    strategy: ReviewStrategy,
    reviewInput: ReviewPromptInput,
    formatted: FormattedDiff,
    diffs: GitLabDiff[],
    signal?: AbortSignal
  ): Promise<{ runtimeSettings: CodexReviewRuntimeSettings; resolution: ReviewStrategyResolution }> {
    throwIfCanceled(signal);
    const modelSettings = await this.reviewSettings.getEffectiveReviewSettings();

    if (strategy !== "auto") {
      const resolution = resolveFixedReviewStrategy(strategy);
      const settings = runtimeSettings(modelSettings.model, resolution.effectiveReasoningEffort);
      await this.recordEvent(context, "info", "review_strategy_selected", "Review strategy selected.", {
        ...strategyMetadata(settings, resolution)
      });
      return { runtimeSettings: settings, resolution };
    }

    await this.recordEvent(context, "info", "codex_triage_started", "Codex triage started for auto review strategy.", {
      model: modelSettings.model,
      modelReasoningEffort: "medium",
      sandboxMode: this.config.codexSandboxMode,
      reviewStrategy: strategy,
      diffBytes: Buffer.byteLength(formatted.text, "utf8"),
      diffFileCount: diffs.length,
      diffTruncated: formatted.truncated,
      omittedFiles: formatted.omittedFiles
    });

    try {
      const triage = await this.triageRunner.triage(
        {
          ...reviewInput,
          changedFiles: changedFilesFromDiffs(diffs),
          diffBytes: Buffer.byteLength(formatted.text, "utf8"),
          diffTruncated: formatted.truncated,
          omittedFiles: formatted.omittedFiles
        },
        modelSettings,
        { signal }
      );
      const resolution: ReviewStrategyResolution = {
        configuredStrategy: "auto",
        effectiveReasoningEffort: triage.recommendedReasoningEffort,
        triageUsed: true,
        triageRiskLevel: triage.riskLevel,
        triageReason: triage.reason,
        triageRiskSignals: triage.riskSignals
      };
      const settings = runtimeSettings(modelSettings.model, resolution.effectiveReasoningEffort);
      await this.recordEvent(context, "info", "codex_triage_finished", "Codex triage selected review effort.", {
        ...strategyMetadata(settings, resolution),
        inputTokens: triage.usage?.input_tokens ?? null,
        outputTokens: triage.usage?.output_tokens ?? null,
        reasoningOutputTokens: triage.usage?.reasoning_output_tokens ?? null,
        totalTokens: triage.usage ? triage.usage.input_tokens + triage.usage.output_tokens : null
      });
      await this.recordEvent(context, "info", "review_strategy_selected", "Review strategy selected.", {
        ...strategyMetadata(settings, resolution)
      });
      return { runtimeSettings: settings, resolution };
    } catch (error) {
      if (isCancellationError(error, signal)) throw error;
      const resolution: ReviewStrategyResolution = {
        configuredStrategy: "auto",
        effectiveReasoningEffort: "high",
        triageUsed: true,
        triageRiskLevel: null,
        triageReason: `Triage failed; using high as safe fallback. ${errorMessage(error)}`,
        triageRiskSignals: []
      };
      const settings = runtimeSettings(modelSettings.model, resolution.effectiveReasoningEffort);
      await this.recordEvent(context, "warn", "codex_triage_failed", "Codex triage failed; falling back to high.", {
        error: errorMessage(error),
        ...strategyMetadata(settings, resolution)
      });
      await this.recordEvent(context, "info", "review_strategy_selected", "Review strategy selected.", {
        ...strategyMetadata(settings, resolution)
      });
      return { runtimeSettings: settings, resolution };
    }
  }

  private async checkoutWorkspace(
    context: EventContext,
    gitlabProject: GitlabProjectRow,
    botToken: string,
    sha: string
  ): Promise<{ path: string; sha: string }> {
    try {
      await this.recordEvent(context, "info", "workspace_checkout_started", "Workspace checkout started.");
      const checkout = await this.workspace.checkout(gitlabProject, botToken, sha);
      await this.state.updateGitlabProjectWorkspaceError(gitlabProject.id, null);
      await this.recordEvent(context, "info", "workspace_checkout_finished", "Workspace checkout finished.", {
        workspacePath: checkout.path,
        checkoutSha: shortSha(checkout.sha)
      });
      return checkout;
    } catch (error) {
      await this.state.updateGitlabProjectWorkspaceError(gitlabProject.id, errorMessage(error));
      await this.recordEvent(context, "error", "workspace_checkout_failed", "Workspace checkout or context collection failed.", {
        error: errorMessage(error)
      });
      throw error;
    }
  }

  private async recordEvent(
    context: EventContext,
    level: ReviewEventLevel,
    step: string,
    message: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const eventMetadata = {
      project: context.project,
      sha: shortSha(context.sha),
      ...metadata
    };
    logReview(level, message, {
      source: context.source,
      runType: context.runType,
      runId: context.runId,
      project: context.project,
      sha: context.sha,
      step,
      metadata
    });
    try {
      await this.state.addReviewEvent({
        runType: context.runType,
        runId: context.runId,
        level,
        step,
        message,
        metadata: eventMetadata
      });
    } catch (error) {
      console.error(`[${context.source}] [review] Failed to persist review event: ${step}`, error);
    }
  }

  private shouldSkip(project: ProjectRow, mr: GitLabMergeRequest): boolean {
    if (mr.draft || mr.work_in_progress) return true;
    const skipLabels = new Set(project.skipLabels.map((label) => label.toLowerCase()));
    return (mr.labels ?? []).some((label) => skipLabels.has(label.toLowerCase()));
  }

  private shouldSkipGroup(group: SharedProjectGroup, mr: GitLabMergeRequest): boolean {
    if (mr.draft || mr.work_in_progress) return true;
    const skipLabels = new Set(group.skipLabels.map((label) => label.toLowerCase()));
    return (mr.labels ?? []).some((label) => skipLabels.has(label.toLowerCase()));
  }
}

function projectDisplayName(project: GitlabProjectRow): string {
  return project.nameWithNamespace ?? project.pathWithNamespace ?? project.gitlabProjectId;
}

function codexStartMetadata(
  settings: CodexReviewRuntimeSettings,
  resolution: ReviewStrategyResolution,
  sandboxMode: string
): Record<string, unknown> {
  return {
    promptVersion: REVIEW_PROMPT_VERSION,
    model: settings.model,
    modelReasoningEffort: settings.reasoningEffort,
    sandboxMode,
    ...strategyMetadata(settings, resolution)
  };
}

function strategyMetadata(settings: CodexReviewRuntimeSettings, resolution: ReviewStrategyResolution): Record<string, unknown> {
  return {
    model: settings.model,
    modelReasoningEffort: settings.reasoningEffort,
    reviewStrategy: resolution.configuredStrategy,
    effectiveReasoningEffort: resolution.effectiveReasoningEffort,
    triageUsed: resolution.triageUsed,
    triageRiskLevel: resolution.triageRiskLevel,
    triageReason: resolution.triageReason,
    triageRiskSignals: resolution.triageRiskSignals
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function orderCommitsOldestFirst(commits: GitLabCommit[]): GitLabCommit[] {
  return [...commits].sort((a, b) => timestampForCommit(a) - timestampForCommit(b));
}

function buildMrReviewInput(
  repoName: string,
  mr: GitLabMergeRequest,
  headSha: string,
  diffText: string,
  workingDirectory: string | null
): ReviewPromptInput {
  return {
    kind: "merge_request",
    repoName,
    baseRef: mr.target_branch ?? null,
    headRef: mr.source_branch ?? headSha,
    sha: headSha,
    branchName: mr.target_branch ?? null,
    diffText,
    workingDirectory
  };
}

function buildCommitReviewInput(
  repoName: string,
  commit: GitLabCommit,
  branchName: string | null,
  diffText: string,
  workingDirectory: string | null
): ReviewPromptInput {
  return {
    kind: "commit",
    repoName,
    baseRef: commit.parent_ids?.[0] ?? null,
    headRef: commit.id,
    sha: commit.id,
    branchName,
    diffText,
    workingDirectory
  };
}

function changedFilesFromDiffs(diffs: GitLabDiff[]): string[] {
  return uniqueNonEmpty(
    diffs.flatMap((diff) => {
      if (diff.old_path === diff.new_path) return [diff.new_path];
      return [diff.old_path, diff.new_path];
    })
  ).slice(0, 200);
}

function filterDiffsForReview(diffs: GitLabDiff[], pathFilters: string[]): GitLabDiff[] {
  const reviewableFiles = new Set(filterChangedFiles(changedFilesFromDiffs(diffs), pathFilters));
  return diffs.filter((diff) => reviewableFiles.has(diff.new_path) || reviewableFiles.has(diff.old_path));
}

function timestampForCommit(commit: GitLabCommit): number {
  const value = commit.committed_date ?? commit.created_at;
  return value ? Date.parse(value) || 0 : 0;
}

function shortSha(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

function stringFromPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return null;
}

function numberFromPayload(payload: Record<string, unknown>, key: string): number | null {
  const value = payload[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function throwIfCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new ReviewCanceledError();
}

async function ensureNotCanceled(signal?: AbortSignal, checkCancellation?: CancellationCheck): Promise<void> {
  throwIfCanceled(signal);
  if (checkCancellation) await checkCancellation();
  throwIfCanceled(signal);
}

function isCancellationError(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (error instanceof ReviewCanceledError) return true;
  if (error instanceof Error && (error.name === "AbortError" || error.message.toLowerCase().includes("abort"))) return true;
  return false;
}
