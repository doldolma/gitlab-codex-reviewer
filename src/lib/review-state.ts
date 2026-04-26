import type { BranchWatchState, CommitReviewRun, GitlabProject, MergeRequest, Project, ReviewEvent, ReviewJob, ReviewRun } from "@prisma/client";
import type { Db } from "./prisma";
import { nowIso } from "./prisma";
import type { GitLabCommit, GitLabMergeRequest } from "./gitlab-client";

export type ProjectRow = {
  id: number;
  userId: number;
  gitlabProjectRefId: number | null;
  gitlabProjectId: string;
  displayName: string;
  enabled: boolean;
  skipLabels: string[];
  mrTargetBranches: string[];
  commitBranches: string[];
};

export type GitlabProjectRow = {
  id: number;
  gitlabHost: string;
  gitlabProjectId: string;
  pathWithNamespace: string | null;
  nameWithNamespace: string | null;
  webUrl: string | null;
  cloneHttpUrl: string | null;
  defaultBranch: string | null;
  workspaceError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SharedProjectGroup = {
  gitlabProject: GitlabProjectRow;
  subscriptions: ProjectRow[];
  representative: ProjectRow;
  skipLabels: string[];
  mrTargetBranches: string[];
  mrTargetsAll: boolean;
  commitBranches: string[];
};

export type ReviewRunRow = {
  id: number;
  projectId: number;
  gitlabProjectRefId: number | null;
  gitlabProjectId: string;
  displayName: string;
  mrIid: number;
  headSha: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  commentId: number | null;
  commentUrl: string | null;
  findingsMarkdown: string | null;
  errorMessage: string | null;
};

export type MergeRequestView = {
  id: number;
  projectId: number;
  gitlabProjectId: string;
  projectName: string;
  mrIid: number;
  title: string;
  webUrl: string;
  authorUsername: string | null;
  labels: string[];
  headSha: string | null;
  state: string;
  draft: boolean;
  observedAt: string;
  reviewRunId: number | null;
  reviewStatus: string | null;
  reviewedAt: string | null;
  commentUrl: string | null;
  findingsMarkdown: string | null;
  errorMessage: string | null;
  reviewMeta: ReviewMeta | null;
};

export type BranchWatchStateRow = {
  id: number;
  projectId: number;
  gitlabProjectRefId: number | null;
  branchName: string;
  lastSeenSha: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CommitReviewTrigger = "auto" | "manual";

export type CommitReviewRunView = {
  id: number;
  userId: number;
  projectId: number | null;
  gitlabProjectRefId: number | null;
  gitlabProjectId: string;
  projectName: string;
  branchName: string | null;
  commitSha: string;
  commitTitle: string;
  commitUrl: string | null;
  authorName: string | null;
  committedDate: string | null;
  trigger: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  commentId: number | null;
  commentUrl: string | null;
  findingsMarkdown: string | null;
  errorMessage: string | null;
  reviewMeta: ReviewMeta | null;
};

export type ReviewRunType = "mr" | "commit";
export type ReviewEventLevel = "info" | "warn" | "error";
export type ReviewJobKind = "commit_manual" | "commit_retry" | "mr_retry" | "scan_user";
export type ReviewJobStatus = "queued" | "running" | "completed" | "failed";

export type ReviewMeta = {
  model: string | null;
  reasoningEffort: string | null;
  promptVersion: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
};

export type ReviewEventView = {
  id: number;
  runType: ReviewRunType;
  runId: number;
  level: ReviewEventLevel;
  step: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ReviewJobView = {
  id: number;
  kind: ReviewJobKind;
  status: ReviewJobStatus;
  userId: number;
  runType: ReviewRunType | null;
  runId: number | null;
  payload: Record<string, unknown>;
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export class ReviewStateStore {
  constructor(private readonly db: Db) {}

  async listProjects(userId: number, enabledOnly = false): Promise<ProjectRow[]> {
    const rows = await this.db.project.findMany({
      where: {
        userId,
        ...(enabledOnly ? { enabled: true } : {})
      },
      orderBy: { displayName: "asc" }
    });
    return rows.map(projectFromRow);
  }

  async createProject(
    userId: number,
    input: {
      gitlabProjectRefId?: number | null;
      gitlabProjectId: string;
      displayName: string;
      skipLabels: string[];
      enabled: boolean;
      mrTargetBranches?: string[];
      commitBranches?: string[];
    }
  ): Promise<ProjectRow> {
    const timestamp = nowIso();
    const row = await this.db.project.create({
      data: {
        userId,
        gitlabProjectRefId: input.gitlabProjectRefId ?? null,
        gitlabProjectId: input.gitlabProjectId,
        displayName: input.displayName,
        enabled: input.enabled,
        skipLabelsJson: JSON.stringify(input.skipLabels),
        mrTargetBranchesJson: JSON.stringify(input.mrTargetBranches ?? []),
        commitBranchesJson: JSON.stringify(input.commitBranches ?? []),
        createdAt: timestamp,
        updatedAt: timestamp
      }
    });
    return projectFromRow(row);
  }

  async updateProject(
    userId: number,
    id: number,
    input: { displayName: string; skipLabels: string[]; enabled: boolean; mrTargetBranches?: string[]; commitBranches?: string[] }
  ): Promise<ProjectRow> {
    const result = await this.db.project.updateMany({
      where: { id, userId },
      data: {
        displayName: input.displayName,
        enabled: input.enabled,
        skipLabelsJson: JSON.stringify(input.skipLabels),
        mrTargetBranchesJson: JSON.stringify(input.mrTargetBranches ?? []),
        commitBranchesJson: JSON.stringify(input.commitBranches ?? []),
        updatedAt: nowIso()
      }
    });
    if (result.count === 0) throw new Error("Project not found");
    return this.getProject(userId, id);
  }

  async upsertGitlabProject(input: {
    gitlabHost: string;
    gitlabProjectId: string;
    pathWithNamespace?: string | null;
    nameWithNamespace?: string | null;
    webUrl?: string | null;
    cloneHttpUrl?: string | null;
    defaultBranch?: string | null;
  }): Promise<GitlabProjectRow> {
    const timestamp = nowIso();
    const row = await this.db.gitlabProject.upsert({
      where: {
        gitlabHost_gitlabProjectId: {
          gitlabHost: input.gitlabHost,
          gitlabProjectId: input.gitlabProjectId
        }
      },
      create: {
        gitlabHost: input.gitlabHost,
        gitlabProjectId: input.gitlabProjectId,
        pathWithNamespace: input.pathWithNamespace ?? null,
        nameWithNamespace: input.nameWithNamespace ?? null,
        webUrl: input.webUrl ?? null,
        cloneHttpUrl: input.cloneHttpUrl ?? null,
        defaultBranch: input.defaultBranch ?? null,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      update: {
        pathWithNamespace: input.pathWithNamespace ?? undefined,
        nameWithNamespace: input.nameWithNamespace ?? undefined,
        webUrl: input.webUrl ?? undefined,
        cloneHttpUrl: input.cloneHttpUrl ?? undefined,
        defaultBranch: input.defaultBranch ?? undefined,
        updatedAt: timestamp
      }
    });
    return gitlabProjectFromRow(row);
  }

  async updateGitlabProjectWorkspaceError(gitlabProjectRefId: number, error: string | null): Promise<void> {
    await this.db.gitlabProject.update({
      where: { id: gitlabProjectRefId },
      data: {
        workspaceError: error,
        updatedAt: nowIso()
      }
    });
  }

  async getGitlabProject(id: number): Promise<GitlabProjectRow> {
    const row = await this.db.gitlabProject.findUnique({ where: { id } });
    if (!row) throw new Error("GitLab project not found");
    return gitlabProjectFromRow(row);
  }

  async deleteProject(userId: number, id: number): Promise<void> {
    await this.db.project.deleteMany({ where: { id, userId } });
  }

  async getProject(userId: number, id: number): Promise<ProjectRow> {
    const row = await this.db.project.findFirst({ where: { id, userId } });
    if (!row) throw new Error("Project not found");
    return projectFromRow(row);
  }

  async findProjectByGitlabId(userId: number, gitlabProjectId: string): Promise<ProjectRow | null> {
    const row = await this.db.project.findFirst({ where: { userId, gitlabProjectId } });
    return row ? projectFromRow(row) : null;
  }

  async listSharedProjectGroups(userId?: number): Promise<SharedProjectGroup[]> {
    const subscriptions = (await this.db.project.findMany({
      where: {
        enabled: true,
        gitlabProjectRefId: { not: null },
        ...(userId ? { userId } : {})
      },
      include: { gitlabProject: true },
      orderBy: { id: "asc" }
    })).filter((row): row is Project & { gitlabProject: GitlabProject } => Boolean(row.gitlabProject));

    const grouped = new Map<number, { gitlabProject: GitlabProject; subscriptions: ProjectRow[] }>();
    for (const subscription of subscriptions) {
      const refId = subscription.gitlabProjectRefId;
      if (!refId) continue;
      const entry = grouped.get(refId) ?? { gitlabProject: subscription.gitlabProject, subscriptions: [] };
      entry.subscriptions.push(projectFromRow(subscription));
      grouped.set(refId, entry);
    }

    return [...grouped.values()].map((entry) => {
      const representative = entry.subscriptions[0];
      const mrTargetsAll = entry.subscriptions.some((project) => project.mrTargetBranches.length === 0);
      return {
        gitlabProject: gitlabProjectFromRow(entry.gitlabProject),
        subscriptions: entry.subscriptions,
        representative,
        skipLabels: uniqueNonEmpty(entry.subscriptions.flatMap((project) => project.skipLabels)),
        mrTargetBranches: mrTargetsAll ? [] : uniqueNonEmpty(entry.subscriptions.flatMap((project) => project.mrTargetBranches)),
        mrTargetsAll,
        commitBranches: uniqueNonEmpty(entry.subscriptions.flatMap((project) => project.commitBranches))
      };
    });
  }

  async upsertMergeRequest(projectId: number, mr: GitLabMergeRequest): Promise<void> {
    await this.db.mergeRequest.upsert({
      where: { projectId_mrIid: { projectId, mrIid: mr.iid } },
      create: {
        projectId,
        mrIid: mr.iid,
        title: mr.title,
        webUrl: mr.web_url,
        authorUsername: mr.author?.username ?? null,
        labelsJson: JSON.stringify(mr.labels ?? []),
        headSha: mr.sha,
        state: mr.state,
        draft: mr.draft,
        updatedAtGitlab: mr.updated_at,
        observedAt: nowIso()
      },
      update: {
        title: mr.title,
        webUrl: mr.web_url,
        authorUsername: mr.author?.username ?? null,
        labelsJson: JSON.stringify(mr.labels ?? []),
        headSha: mr.sha,
        state: mr.state,
        draft: mr.draft,
        updatedAtGitlab: mr.updated_at,
        observedAt: nowIso()
      }
    });
  }

  async upsertMergeRequestShared(gitlabProjectRefId: number, representativeProjectId: number, mr: GitLabMergeRequest): Promise<void> {
    await this.db.mergeRequest.upsert({
      where: { gitlabProjectRefId_mrIid: { gitlabProjectRefId, mrIid: mr.iid } },
      create: {
        projectId: representativeProjectId,
        gitlabProjectRefId,
        mrIid: mr.iid,
        title: mr.title,
        webUrl: mr.web_url,
        authorUsername: mr.author?.username ?? null,
        labelsJson: JSON.stringify(mr.labels ?? []),
        headSha: mr.sha,
        state: mr.state,
        draft: mr.draft,
        updatedAtGitlab: mr.updated_at,
        observedAt: nowIso()
      },
      update: {
        projectId: representativeProjectId,
        title: mr.title,
        webUrl: mr.web_url,
        authorUsername: mr.author?.username ?? null,
        labelsJson: JSON.stringify(mr.labels ?? []),
        headSha: mr.sha,
        state: mr.state,
        draft: mr.draft,
        updatedAtGitlab: mr.updated_at,
        observedAt: nowIso()
      }
    });
  }

  async hasCompletedRun(projectId: number, mrIid: number, headSha: string): Promise<boolean> {
    const row = await this.db.reviewRun.findFirst({
      where: {
        projectId,
        mrIid,
        headSha,
        status: { in: ["no_findings", "commented"] }
      },
      select: { id: true }
    });
    return Boolean(row);
  }

  async hasCompletedSharedRun(gitlabProjectRefId: number, mrIid: number, headSha: string): Promise<boolean> {
    const row = await this.db.reviewRun.findFirst({
      where: {
        gitlabProjectRefId,
        mrIid,
        headSha,
        status: { in: ["no_findings", "commented"] }
      },
      select: { id: true }
    });
    return Boolean(row);
  }

  async getRunForSha(projectId: number, mrIid: number, headSha: string): Promise<ReviewRunRow | null> {
    const row = await this.db.reviewRun.findFirst({
      where: { projectId, mrIid, headSha },
      include: { project: true }
    });
    return row ? reviewRunFromRow(row, row.project) : null;
  }

  async getRunById(userId: number, id: number): Promise<ReviewRunRow | null> {
    const refs = await this.userGitlabProjectRefIds(userId);
    const row = await this.db.reviewRun.findFirst({
      where: {
        id,
        OR: [
          { project: { userId } },
          ...(refs.length ? [{ gitlabProjectRefId: { in: refs } }] : [])
        ]
      },
      include: { project: true }
    });
    return row ? reviewRunFromRow(row, row.project) : null;
  }

  async startRun(projectId: number, mrIid: number, headSha: string, status = "running"): Promise<number> {
    const timestamp = nowIso();
    const existing = await this.getRunForSha(projectId, mrIid, headSha);
    if (existing) {
      await this.db.reviewRun.update({
        where: { id: existing.id },
        data: {
          status,
          startedAt: timestamp,
          finishedAt: null,
          errorMessage: null
        }
      });
      return existing.id;
    }

    const row = await this.db.reviewRun.create({
      data: {
        projectId,
        mrIid,
        headSha,
        status,
        startedAt: timestamp
      }
    });
    return row.id;
  }

  async startSharedRun(gitlabProjectRefId: number, representativeProjectId: number, mrIid: number, headSha: string, status = "running"): Promise<number> {
    const timestamp = nowIso();
    const existing = await this.db.reviewRun.findFirst({
      where: { gitlabProjectRefId, mrIid, headSha },
      include: { project: true }
    });
    if (existing) {
      await this.db.reviewRun.update({
        where: { id: existing.id },
        data: {
          projectId: representativeProjectId,
          status,
          startedAt: timestamp,
          finishedAt: null,
          errorMessage: null
        }
      });
      return existing.id;
    }

    const row = await this.db.reviewRun.create({
      data: {
        projectId: representativeProjectId,
        gitlabProjectRefId,
        mrIid,
        headSha,
        status,
        startedAt: timestamp
      }
    });
    return row.id;
  }

  async finishNoFindings(
    runId: number,
    markdown: string | null = null,
    comment: { id: number | null; url: string | null } | null = null
  ): Promise<void> {
    await this.db.reviewRun.update({
      where: { id: runId },
      data: {
        status: "no_findings",
        finishedAt: nowIso(),
        commentId: comment?.id ?? null,
        commentUrl: comment?.url ?? null,
        findingsMarkdown: markdown,
        errorMessage: null
      }
    });
  }

  async markRunQueued(userId: number, runId: number): Promise<ReviewRunRow> {
    const run = await this.getRunById(userId, runId);
    if (!run) throw new Error("Review run not found");
    await this.db.reviewRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        startedAt: nowIso(),
        finishedAt: null,
        errorMessage: null
      }
    });
    const updated = await this.getRunById(userId, runId);
    if (!updated) throw new Error("Review run not found");
    return updated;
  }

  async finishCommented(runId: number, comment: { id: number; url: string | null }, markdown: string): Promise<void> {
    await this.db.reviewRun.update({
      where: { id: runId },
      data: {
        status: "commented",
        finishedAt: nowIso(),
        commentId: comment.id,
        commentUrl: comment.url,
        findingsMarkdown: markdown,
        errorMessage: null
      }
    });
  }

  async failRun(runId: number, error: unknown): Promise<void> {
    await this.db.reviewRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        finishedAt: nowIso(),
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
  }

  async getBranchWatchState(projectId: number, branchName: string): Promise<BranchWatchStateRow | null> {
    const row = await this.db.branchWatchState.findFirst({ where: { projectId, branchName } });
    return row ? branchWatchStateFromRow(row) : null;
  }

  async getSharedBranchWatchState(gitlabProjectRefId: number, branchName: string): Promise<BranchWatchStateRow | null> {
    const row = await this.db.branchWatchState.findFirst({ where: { gitlabProjectRefId, branchName } });
    return row ? branchWatchStateFromRow(row) : null;
  }

  async setBranchWatchState(
    projectId: number,
    branchName: string,
    lastSeenSha: string | null,
    lastError: string | null = null
  ): Promise<BranchWatchStateRow> {
    const timestamp = nowIso();
    const row = await this.db.branchWatchState.upsert({
      where: { projectId_branchName: { projectId, branchName } },
      create: {
        projectId,
        branchName,
        lastSeenSha,
        lastError,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      update: {
        lastSeenSha,
        lastError,
        updatedAt: timestamp
      }
    });
    return branchWatchStateFromRow(row);
  }

  async setSharedBranchWatchState(
    gitlabProjectRefId: number,
    representativeProjectId: number,
    branchName: string,
    lastSeenSha: string | null,
    lastError: string | null = null
  ): Promise<BranchWatchStateRow> {
    const timestamp = nowIso();
    const row = await this.db.branchWatchState.upsert({
      where: { gitlabProjectRefId_branchName: { gitlabProjectRefId, branchName } },
      create: {
        projectId: representativeProjectId,
        gitlabProjectRefId,
        branchName,
        lastSeenSha,
        lastError,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      update: {
        projectId: representativeProjectId,
        lastSeenSha,
        lastError,
        updatedAt: timestamp
      }
    });
    return branchWatchStateFromRow(row);
  }

  async hasCompletedCommitRun(userId: number, gitlabProjectId: string, commitSha: string): Promise<boolean> {
    const row = await this.db.commitReviewRun.findFirst({
      where: {
        userId,
        gitlabProjectId,
        commitSha,
        status: { in: ["no_findings", "commented"] }
      },
      select: { id: true }
    });
    return Boolean(row);
  }

  async hasCompletedSharedCommitRun(gitlabProjectRefId: number, commitSha: string): Promise<boolean> {
    const row = await this.db.commitReviewRun.findFirst({
      where: {
        gitlabProjectRefId,
        commitSha,
        status: { in: ["no_findings", "commented"] }
      },
      select: { id: true }
    });
    return Boolean(row);
  }

  async getCommitRunById(userId: number, id: number): Promise<CommitReviewRunView | null> {
    const refs = await this.userGitlabProjectRefIds(userId);
    const row = await this.db.commitReviewRun.findFirst({
      where: {
        id,
        OR: [
          { userId },
          ...(refs.length ? [{ gitlabProjectRefId: { in: refs } }] : [])
        ]
      },
      include: { project: true }
    });
    return row ? commitReviewRunFromRow(row) : null;
  }

  async getCommitRunForSha(userId: number, gitlabProjectId: string, commitSha: string): Promise<CommitReviewRunView | null> {
    const row = await this.db.commitReviewRun.findFirst({
      where: { userId, gitlabProjectId, commitSha },
      include: { project: true }
    });
    return row ? commitReviewRunFromRow(row) : null;
  }

  async startCommitRun(
    userId: number,
    projectId: number | null,
    gitlabProjectId: string,
    branchName: string | null,
    commit: GitLabCommit,
    trigger: CommitReviewTrigger,
    status = "running"
  ): Promise<number> {
    const timestamp = nowIso();
    const title = commit.title ?? commit.message?.split("\n")[0] ?? commit.id.slice(0, 10);
    const existing = await this.getCommitRunForSha(userId, gitlabProjectId, commit.id);
    if (existing) {
      await this.db.commitReviewRun.update({
        where: { id: existing.id },
        data: {
          projectId,
          branchName,
          commitTitle: title,
          commitUrl: commit.web_url ?? null,
          authorName: commit.author_name ?? null,
          committedDate: commit.committed_date ?? commit.created_at ?? null,
          trigger,
          status,
          startedAt: timestamp,
          finishedAt: null,
          errorMessage: null
        }
      });
      return existing.id;
    }

    const row = await this.db.commitReviewRun.create({
      data: {
        userId,
        projectId,
        gitlabProjectId,
        branchName,
        commitSha: commit.id,
        commitTitle: title,
        commitUrl: commit.web_url ?? null,
        authorName: commit.author_name ?? null,
        committedDate: commit.committed_date ?? commit.created_at ?? null,
        trigger,
        status,
        startedAt: timestamp
      }
    });
    return row.id;
  }

  async startSharedCommitRun(
    representativeUserId: number,
    representativeProjectId: number | null,
    gitlabProjectRefId: number,
    gitlabProjectId: string,
    branchName: string | null,
    commit: GitLabCommit,
    trigger: CommitReviewTrigger,
    status = "running"
  ): Promise<number> {
    const timestamp = nowIso();
    const title = commit.title ?? commit.message?.split("\n")[0] ?? commit.id.slice(0, 10);
    const existing = await this.db.commitReviewRun.findFirst({ where: { gitlabProjectRefId, commitSha: commit.id } });
    if (existing) {
      await this.db.commitReviewRun.update({
        where: { id: existing.id },
        data: {
          userId: representativeUserId,
          projectId: representativeProjectId,
          branchName,
          commitTitle: title,
          commitUrl: commit.web_url ?? null,
          authorName: commit.author_name ?? null,
          committedDate: commit.committed_date ?? commit.created_at ?? null,
          trigger,
          status,
          startedAt: timestamp,
          finishedAt: null,
          errorMessage: null
        }
      });
      return existing.id;
    }

    const row = await this.db.commitReviewRun.create({
      data: {
        userId: representativeUserId,
        projectId: representativeProjectId,
        gitlabProjectRefId,
        gitlabProjectId,
        branchName,
        commitSha: commit.id,
        commitTitle: title,
        commitUrl: commit.web_url ?? null,
        authorName: commit.author_name ?? null,
        committedDate: commit.committed_date ?? commit.created_at ?? null,
        trigger,
        status,
        startedAt: timestamp
      }
    });
    return row.id;
  }

  async finishCommitNoFindings(
    runId: number,
    markdown: string | null = null,
    comment: { id: number | null; url: string | null } | null = null
  ): Promise<void> {
    await this.db.commitReviewRun.update({
      where: { id: runId },
      data: {
        status: "no_findings",
        finishedAt: nowIso(),
        commentId: comment?.id ?? null,
        commentUrl: comment?.url ?? null,
        findingsMarkdown: markdown,
        errorMessage: null
      }
    });
  }

  async markCommitRunQueued(userId: number, runId: number): Promise<CommitReviewRunView> {
    const run = await this.getCommitRunById(userId, runId);
    if (!run) throw new Error("Commit review run not found");
    await this.db.commitReviewRun.update({
      where: { id: runId },
      data: {
        status: "queued",
        startedAt: nowIso(),
        finishedAt: null,
        errorMessage: null
      }
    });
    const updated = await this.getCommitRunById(userId, runId);
    if (!updated) throw new Error("Commit review run not found");
    return updated;
  }

  async finishCommitCommented(runId: number, comment: { id: number | null; url: string | null }, markdown: string): Promise<void> {
    await this.db.commitReviewRun.update({
      where: { id: runId },
      data: {
        status: "commented",
        finishedAt: nowIso(),
        commentId: comment.id,
        commentUrl: comment.url,
        findingsMarkdown: markdown,
        errorMessage: null
      }
    });
  }

  async failCommitRun(runId: number, error: unknown): Promise<void> {
    await this.db.commitReviewRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        finishedAt: nowIso(),
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
  }

  async addReviewEvent(input: {
    runType: ReviewRunType;
    runId: number;
    level: ReviewEventLevel;
    step: string;
    message: string;
    metadata?: Record<string, unknown>;
  }): Promise<ReviewEventView> {
    const row = await this.db.reviewEvent.create({
      data: {
        runType: input.runType,
        runId: input.runId,
        level: input.level,
        step: input.step,
        message: input.message,
        metadataJson: JSON.stringify(safeMetadata(input.metadata ?? {})),
        createdAt: nowIso()
      }
    });
    return reviewEventFromRow(row);
  }

  async createReviewJob(input: {
    kind: ReviewJobKind;
    userId: number;
    runType?: ReviewRunType | null;
    runId?: number | null;
    payload?: Record<string, unknown>;
  }): Promise<ReviewJobView> {
    const timestamp = nowIso();
    const row = await this.db.reviewJob.create({
      data: {
        kind: input.kind,
        status: "queued",
        userId: input.userId,
        runType: input.runType ?? null,
        runId: input.runId ?? null,
        payloadJson: JSON.stringify(safeMetadata(input.payload ?? {})),
        createdAt: timestamp,
        updatedAt: timestamp
      }
    });
    return reviewJobFromRow(row);
  }

  async claimNextReviewJob(): Promise<ReviewJobView | null> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const next = await this.db.reviewJob.findFirst({
        where: { status: "queued" },
        orderBy: [{ updatedAt: "asc" }, { id: "asc" }]
      });
      if (!next) return null;

      const timestamp = nowIso();
      const result = await this.db.reviewJob.updateMany({
        where: { id: next.id, status: "queued" },
        data: {
          status: "running",
          attempts: { increment: 1 },
          startedAt: timestamp,
          updatedAt: timestamp,
          errorMessage: null
        }
      });
      if (result.count === 0) continue;

      const claimed = await this.db.reviewJob.findUnique({ where: { id: next.id } });
      return claimed ? reviewJobFromRow(claimed) : null;
    }
    return null;
  }

  async completeReviewJob(id: number): Promise<void> {
    const timestamp = nowIso();
    await this.db.reviewJob.update({
      where: { id },
      data: {
        status: "completed",
        updatedAt: timestamp,
        finishedAt: timestamp,
        errorMessage: null
      }
    });
  }

  async failReviewJob(id: number, error: unknown): Promise<void> {
    const timestamp = nowIso();
    await this.db.reviewJob.update({
      where: { id },
      data: {
        status: "failed",
        updatedAt: timestamp,
        finishedAt: timestamp,
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
  }

  async requeueReviewJob(id: number, reason: string | null = null): Promise<void> {
    await this.db.reviewJob.update({
      where: { id },
      data: {
        status: "queued",
        updatedAt: nowIso(),
        startedAt: null,
        errorMessage: reason
      }
    });
  }

  async listReviewEvents(userId: number, runType: ReviewRunType, runId: number): Promise<ReviewEventView[]> {
    const run = runType === "mr" ? await this.getRunById(userId, runId) : await this.getCommitRunById(userId, runId);
    if (!run) throw new Error("Review run not found");

    const rows = await this.db.reviewEvent.findMany({
      where: { runType, runId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    return rows.map(reviewEventFromRow);
  }

  async acquireLock(key: string, ttlMs = 30 * 60 * 1000): Promise<boolean> {
    const now = Date.now();
    const existing = await this.db.reviewLock.findUnique({ where: { lockKey: key } });
    if (existing && (!existing.expiresAt || Date.parse(existing.expiresAt) <= now)) {
      await this.db.reviewLock.deleteMany({ where: { lockKey: key } });
    }

    try {
      await this.db.reviewLock.create({
        data: {
          lockKey: key,
          acquiredAt: new Date(now).toISOString(),
          expiresAt: new Date(now + ttlMs).toISOString()
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  async releaseLock(key: string): Promise<void> {
    await this.db.reviewLock.deleteMany({ where: { lockKey: key } });
  }

  async listMergeRequestViews(userId: number): Promise<MergeRequestView[]> {
    const userProjects = await this.db.project.findMany({ where: { userId } });
    const projectByRef = new Map<number, Project>();
    for (const project of userProjects) {
      if (project.gitlabProjectRefId) projectByRef.set(project.gitlabProjectRefId, project);
    }
    const refIds = [...projectByRef.keys()];
    const rows = await this.db.mergeRequest.findMany({
      where: {
        OR: [
          { project: { userId } },
          ...(refIds.length ? [{ gitlabProjectRefId: { in: refIds } }] : [])
        ]
      },
      include: { project: true },
      orderBy: { observedAt: "desc" }
    });

    const runPairs = await Promise.all(
      rows.map(async (row) => ({
        row,
        run: row.headSha
          ? await this.db.reviewRun.findFirst({
              where: {
                projectId: row.projectId,
                mrIid: row.mrIid,
                headSha: row.headSha
              },
              orderBy: { startedAt: "desc" }
            })
          : null
      }))
    );
    const reviewMetaByRunId = await this.reviewMetaByRunIds(
      "mr",
      runPairs.map((pair) => pair.run?.id).filter((id): id is number => typeof id === "number")
    );

    return runPairs.map(({ row, run }) => {
      const displayProject = row.gitlabProjectRefId ? projectByRef.get(row.gitlabProjectRefId) ?? row.project : row.project;
      return mergeRequestViewFromRow(row, displayProject, run, run ? reviewMetaByRunId.get(run.id) ?? null : null);
    });
  }

  async listCommitReviewRuns(userId: number): Promise<CommitReviewRunView[]> {
    const userProjects = await this.db.project.findMany({ where: { userId } });
    const projectByRef = new Map<number, Project>();
    for (const project of userProjects) {
      if (project.gitlabProjectRefId) projectByRef.set(project.gitlabProjectRefId, project);
    }
    const refIds = [...projectByRef.keys()];
    const rows = await this.db.commitReviewRun.findMany({
      where: {
        OR: [
          { userId },
          ...(refIds.length ? [{ gitlabProjectRefId: { in: refIds } }] : [])
        ]
      },
      include: { project: true },
      orderBy: { startedAt: "desc" }
    });
    const reviewMetaByRunId = await this.reviewMetaByRunIds("commit", rows.map((row) => row.id));
    return rows.map((row) =>
      commitReviewRunFromRow(
        row,
        row.gitlabProjectRefId ? projectByRef.get(row.gitlabProjectRefId) ?? row.project : row.project,
        reviewMetaByRunId.get(row.id) ?? null
      )
    );
  }

  async dashboardStats(userId: number): Promise<{
    projectCount: number;
    mrCount: number;
    runningCount: number;
    failedCount: number;
    commentedCount: number;
  }> {
    const refIds = await this.userGitlabProjectRefIds(userId);
    const [projectCount, mrCount, runningCount, failedCount, commentedCount] = await Promise.all([
      this.db.project.count({ where: { userId, enabled: true } }),
      this.db.mergeRequest.count({
        where: {
          state: "opened",
          OR: [
            { project: { userId } },
            ...(refIds.length ? [{ gitlabProjectRefId: { in: refIds } }] : [])
          ]
        }
      }),
      this.countRunsByStatuses(userId, ["queued", "running"]),
      this.countRunsByStatus(userId, "failed"),
      this.countRunsByStatus(userId, "commented")
    ]);
    return { projectCount, mrCount, runningCount, failedCount, commentedCount };
  }

  private async countRunsByStatus(userId: number, status: string): Promise<number> {
    return this.countRunsByStatuses(userId, [status]);
  }

  private async countRunsByStatuses(userId: number, statuses: string[]): Promise<number> {
    const refIds = await this.userGitlabProjectRefIds(userId);
    const [mergeRequestRuns, commitRuns] = await Promise.all([
      this.db.reviewRun.count({
        where: {
          status: { in: statuses },
          OR: [
            { project: { userId } },
            ...(refIds.length ? [{ gitlabProjectRefId: { in: refIds } }] : [])
          ]
        }
      }),
      this.db.commitReviewRun.count({
        where: {
          status: { in: statuses },
          OR: [
            { userId },
            ...(refIds.length ? [{ gitlabProjectRefId: { in: refIds } }] : [])
          ]
        }
      })
    ]);
    return mergeRequestRuns + commitRuns;
  }

  async clearReviewHistory(): Promise<void> {
    await this.db.reviewEvent.deleteMany();
    await this.db.reviewJob.deleteMany();
    await this.db.reviewLock.deleteMany();
    await this.db.reviewRun.deleteMany();
    await this.db.commitReviewRun.deleteMany();
    await this.db.mergeRequest.deleteMany();
    await this.db.branchWatchState.deleteMany();
    await this.db.gitlabProject.updateMany({
      data: {
        workspaceError: null,
        updatedAt: nowIso()
      }
    });
  }

  private async userGitlabProjectRefIds(userId: number): Promise<number[]> {
    const rows = await this.db.project.findMany({
      where: { userId, gitlabProjectRefId: { not: null } },
      select: { gitlabProjectRefId: true }
    });
    return rows.map((row) => row.gitlabProjectRefId).filter((id): id is number => id !== null);
  }

  private async reviewMetaByRunIds(runType: ReviewRunType, runIds: number[]): Promise<Map<number, ReviewMeta>> {
    if (!runIds.length) return new Map();
    const rows = await this.db.reviewEvent.findMany({
      where: {
        runType,
        runId: { in: runIds },
        step: { in: ["codex_started", "codex_usage"] }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    const byRun = new Map<number, ReviewMeta>();
    for (const row of rows) {
      const metadata = parseJsonRecord(row.metadataJson);
      const current = byRun.get(row.runId) ?? emptyReviewMeta();
      if (row.step === "codex_started") {
        current.model = stringFromMetadata(metadata, "model");
        current.reasoningEffort = stringFromMetadata(metadata, "modelReasoningEffort");
        current.promptVersion = stringFromMetadata(metadata, "promptVersion");
      }
      if (row.step === "codex_usage") {
        current.inputTokens = numberFromMetadata(metadata, "inputTokens") ?? numberFromMetadata(metadata, "input_tokens");
        current.outputTokens = numberFromMetadata(metadata, "outputTokens") ?? numberFromMetadata(metadata, "output_tokens");
        current.reasoningTokens =
          numberFromMetadata(metadata, "reasoningOutputTokens") ?? numberFromMetadata(metadata, "reasoning_output_tokens");
        current.totalTokens =
          numberFromMetadata(metadata, "totalTokens") ??
          (current.inputTokens !== null && current.outputTokens !== null ? current.inputTokens + current.outputTokens : null);
      }
      byRun.set(row.runId, current);
    }
    return byRun;
  }
}

function projectFromRow(row: Project): ProjectRow {
  return {
    id: row.id,
    userId: row.userId,
    gitlabProjectRefId: row.gitlabProjectRefId,
    gitlabProjectId: row.gitlabProjectId,
    displayName: row.displayName,
    enabled: row.enabled,
    skipLabels: parseJsonArray(row.skipLabelsJson),
    mrTargetBranches: parseJsonArray(row.mrTargetBranchesJson),
    commitBranches: parseJsonArray(row.commitBranchesJson)
  };
}

function gitlabProjectFromRow(row: GitlabProject): GitlabProjectRow {
  return {
    id: row.id,
    gitlabHost: row.gitlabHost,
    gitlabProjectId: row.gitlabProjectId,
    pathWithNamespace: row.pathWithNamespace,
    nameWithNamespace: row.nameWithNamespace,
    webUrl: row.webUrl,
    cloneHttpUrl: row.cloneHttpUrl,
    defaultBranch: row.defaultBranch,
    workspaceError: row.workspaceError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function branchWatchStateFromRow(row: BranchWatchState): BranchWatchStateRow {
  return {
    id: row.id,
    projectId: row.projectId,
    gitlabProjectRefId: row.gitlabProjectRefId,
    branchName: row.branchName,
    lastSeenSha: row.lastSeenSha,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function reviewRunFromRow(row: ReviewRun, project: Project): ReviewRunRow {
  return {
    id: row.id,
    projectId: row.projectId,
    gitlabProjectRefId: row.gitlabProjectRefId,
    gitlabProjectId: project.gitlabProjectId,
    displayName: project.displayName,
    mrIid: row.mrIid,
    headSha: row.headSha,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    commentId: row.commentId,
    commentUrl: row.commentUrl,
    findingsMarkdown: row.findingsMarkdown,
    errorMessage: row.errorMessage
  };
}

function mergeRequestViewFromRow(row: MergeRequest, project: Project, run: ReviewRun | null, reviewMeta: ReviewMeta | null = null): MergeRequestView {
  return {
    id: row.id,
    projectId: row.projectId,
    gitlabProjectId: project.gitlabProjectId,
    projectName: project.displayName,
    mrIid: row.mrIid,
    title: row.title,
    webUrl: row.webUrl,
    authorUsername: row.authorUsername,
    labels: parseJsonArray(row.labelsJson),
    headSha: row.headSha,
    state: row.state,
    draft: row.draft,
    observedAt: row.observedAt,
    reviewRunId: run?.id ?? null,
    reviewStatus: run?.status ?? null,
    reviewedAt: run?.finishedAt ?? null,
    commentUrl: run?.commentUrl ?? null,
    findingsMarkdown: run?.findingsMarkdown ?? null,
    errorMessage: run?.errorMessage ?? null,
    reviewMeta
  };
}

function commitReviewRunFromRow(
  row: CommitReviewRun & { project?: Project | null },
  displayProject = row.project,
  reviewMeta: ReviewMeta | null = null
): CommitReviewRunView {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    gitlabProjectRefId: row.gitlabProjectRefId,
    gitlabProjectId: row.gitlabProjectId,
    projectName: displayProject?.displayName ?? row.gitlabProjectId,
    branchName: row.branchName,
    commitSha: row.commitSha,
    commitTitle: row.commitTitle,
    commitUrl: row.commitUrl,
    authorName: row.authorName,
    committedDate: row.committedDate,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    commentId: row.commentId,
    commentUrl: row.commentUrl,
    findingsMarkdown: row.findingsMarkdown,
    errorMessage: row.errorMessage,
    reviewMeta
  };
}

function reviewEventFromRow(row: ReviewEvent): ReviewEventView {
  return {
    id: row.id,
    runType: row.runType === "commit" ? "commit" : "mr",
    runId: row.runId,
    level: row.level === "error" ? "error" : row.level === "warn" ? "warn" : "info",
    step: row.step,
    message: row.message,
    metadata: parseJsonRecord(row.metadataJson),
    createdAt: row.createdAt
  };
}

function reviewJobFromRow(row: ReviewJob): ReviewJobView {
  return {
    id: row.id,
    kind: isReviewJobKind(row.kind) ? row.kind : "scan_user",
    status: isReviewJobStatus(row.status) ? row.status : "failed",
    userId: row.userId,
    runType: row.runType === "commit" ? "commit" : row.runType === "mr" ? "mr" : null,
    runId: row.runId,
    payload: parseJsonRecord(row.payloadJson),
    attempts: row.attempts,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt
  };
}

function isReviewJobKind(value: string): value is ReviewJobKind {
  return value === "commit_manual" || value === "commit_retry" || value === "mr_retry" || value === "scan_user";
}

function isReviewJobStatus(value: string): value is ReviewJobStatus {
  return value === "queued" || value === "running" || value === "completed" || value === "failed";
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJsonRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function emptyReviewMeta(): ReviewMeta {
  return {
    model: null,
    reasoningEffort: null,
    promptVersion: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    totalTokens: null
  };
}

function stringFromMetadata(metadata: Record<string, unknown>, key: string): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function numberFromMetadata(metadata: Record<string, unknown>, key: string): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function safeMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const denyKeys = new Set(["token", "accesstoken", "authorization", "authheader", "prompt", "rawprompt", "rawdiff", "difftext", "reviewinput"]);
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !denyKeys.has(key.toLowerCase().replaceAll(/[^a-z0-9]/g, "")))
      .map(([key, value]) => [key, safeMetadataValue(value)])
  );
}

function safeMetadataValue(value: unknown): unknown {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (Array.isArray(value)) return value.map(safeMetadataValue);
  if (value && typeof value === "object") return safeMetadata(value as Record<string, unknown>);
  return String(value);
}
