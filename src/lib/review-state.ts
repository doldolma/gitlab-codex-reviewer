import type { BranchWatchState, CommitReviewRun, GitlabProject, MergeRequest, Project, ProjectReviewInstruction as PrismaProjectReviewInstruction, ReviewEvent, ReviewJob, ReviewRun } from "@prisma/client";
import type { Db } from "./prisma";
import { nowIso } from "./prisma";
import type { GitLabCommit, GitLabMergeRequest } from "./gitlab-client";
import { parseReviewStrategy, type ReviewStrategy } from "./review-strategy";
import { defaultPathFilters, normalizeInstructions, normalizePathFilters, parseReviewProfile, type ProjectReviewConfig, type ReviewProfile } from "./review-config";
import type { StructuredReview } from "./prompts";

export type ProjectRow = {
  id: number;
  userId: number;
  gitlabProjectRefId: number | null;
  gitlabProjectId: string;
  displayName: string;
  webUrl: string | null;
  enabled: boolean;
  skipLabels: string[];
  mrTargetBranches: string[];
  commitBranches: string[];
  reviewStrategy: ReviewStrategy;
  reviewStrategyUpdatedByUserId: number | null;
  reviewStrategyUpdatedAt: string | null;
  reviewProfile: ReviewProfile;
  pathFilters: string[];
  webhookStatus: "connected" | "error" | "missing";
  webhookUrl: string | null;
  webhookLastVerifiedAt: string | null;
  webhookError: string | null;
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
  webhookHookId: number | null;
  webhookSecretEncrypted: string | null;
  webhookUrl: string | null;
  webhookLastVerifiedAt: string | null;
  webhookError: string | null;
  reviewStrategy: ReviewStrategy;
  reviewStrategyUpdatedByUserId: number | null;
  reviewStrategyUpdatedAt: string | null;
  reviewProfile: ReviewProfile;
  pathFilters: string[];
  createdAt: string;
  updatedAt: string;
};

export type SharedProjectGroup = {
  gitlabProject: GitlabProjectRow;
  subscriptions: ProjectRow[];
  representative: ProjectRow;
  skipLabels: string[];
  mrTargetBranches: string[];
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
  structuredReview: StructuredReview | null;
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
  structuredReview: StructuredReview | null;
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
  reviewStrategyOverride: ReviewStrategy | null;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  commentId: number | null;
  commentUrl: string | null;
  findingsMarkdown: string | null;
  structuredReview: StructuredReview | null;
  errorMessage: string | null;
  reviewMeta: ReviewMeta | null;
};

export type ReviewFeedbackRating = "helpful" | "false_positive" | "too_minor" | "missed_issue";

export type ReviewRunType = "mr" | "commit";
export type ReviewEventLevel = "info" | "warn" | "error";
export type ReviewJobKind = "commit_manual" | "commit_retry" | "mr_retry" | "scan_user" | "commit_webhook" | "mr_webhook";
export type ReviewJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export type ReviewMeta = {
  model: string | null;
  reasoningEffort: string | null;
  promptVersion: string | null;
  reviewStrategy: string | null;
  triageUsed: boolean | null;
  triageRiskLevel: string | null;
  triageReason: string | null;
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
        ...(enabledOnly ? { enabled: true } : {})
      },
      include: { gitlabProject: true },
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
    input: { enabled: boolean; mrTargetBranches?: string[]; commitBranches?: string[] }
  ): Promise<ProjectRow> {
    const result = await this.db.project.updateMany({
      where: { id },
      data: {
        enabled: input.enabled,
        skipLabelsJson: JSON.stringify([]),
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

  async updateGitlabProjectWebhook(
    gitlabProjectRefId: number,
    input: {
      webhookHookId?: number | null;
      webhookSecretEncrypted?: string | null;
      webhookUrl?: string | null;
      webhookLastVerifiedAt?: string | null;
      webhookError?: string | null;
    }
  ): Promise<GitlabProjectRow> {
    const row = await this.db.gitlabProject.update({
      where: { id: gitlabProjectRefId },
      data: {
        webhookHookId: input.webhookHookId,
        webhookSecretEncrypted: input.webhookSecretEncrypted,
        webhookUrl: input.webhookUrl,
        webhookLastVerifiedAt: input.webhookLastVerifiedAt,
        webhookError: input.webhookError,
        updatedAt: nowIso()
      }
    });
    return gitlabProjectFromRow(row);
  }

  async updateGitlabProjectReviewStrategy(userId: number, projectId: number, reviewStrategy: ReviewStrategy): Promise<ProjectRow> {
    const project = await this.db.project.findFirst({
      where: { id: projectId },
      include: { gitlabProject: true }
    });
    if (!project) throw new Error("Project not found");
    if (!project.gitlabProjectRefId) throw new Error("Shared GitLab project is not linked");

    const timestamp = nowIso();
    await this.db.gitlabProject.update({
      where: { id: project.gitlabProjectRefId },
      data: {
        reviewStrategy,
        reviewStrategyUpdatedByUserId: userId,
        reviewStrategyUpdatedAt: timestamp,
        updatedAt: timestamp
      }
    });
    return this.getProject(userId, projectId);
  }

  async getProjectReviewConfig(userId: number, projectId: number): Promise<ProjectReviewConfig> {
    const project = await this.db.project.findFirst({
      where: { id: projectId },
      include: { gitlabProject: { include: { reviewInstructions: { orderBy: { id: "asc" } } } } }
    });
    if (!project) throw new Error("Project not found");
    if (!project.gitlabProject) throw new Error("Shared GitLab project is not linked");
    return reviewConfigFromProject(project.gitlabProject, project.gitlabProject.reviewInstructions);
  }

  async getSharedProjectReviewConfig(gitlabProjectRefId: number): Promise<ProjectReviewConfig> {
    const project = await this.db.gitlabProject.findUnique({
      where: { id: gitlabProjectRefId },
      include: { reviewInstructions: { orderBy: { id: "asc" } } }
    });
    if (!project) throw new Error("GitLab project not found");
    return reviewConfigFromProject(project, project.reviewInstructions);
  }

  async updateProjectReviewConfig(
    userId: number,
    projectId: number,
    input: { reviewProfile: ReviewProfile; pathFilters: string[]; instructions: { id?: number; pathGlob: string; instructions: string; enabled: boolean }[] }
  ): Promise<ProjectReviewConfig> {
    const project = await this.db.project.findFirst({ where: { id: projectId } });
    if (!project) throw new Error("Project not found");
    if (!project.gitlabProjectRefId) throw new Error("Shared GitLab project is not linked");

    const timestamp = nowIso();
    const normalizedInstructions = normalizeInstructions(input.instructions);
    await this.db.$transaction(async (tx) => {
      await tx.gitlabProject.update({
        where: { id: project.gitlabProjectRefId! },
        data: {
          reviewProfile: input.reviewProfile,
          pathFiltersJson: JSON.stringify(normalizePathFilters(input.pathFilters)),
          updatedAt: timestamp
        }
      });
      await tx.projectReviewInstruction.deleteMany({ where: { gitlabProjectRefId: project.gitlabProjectRefId! } });
      if (normalizedInstructions.length) {
        await tx.projectReviewInstruction.createMany({
          data: normalizedInstructions.map((instruction) => ({
            gitlabProjectRefId: project.gitlabProjectRefId!,
            pathGlob: instruction.pathGlob,
            instructions: instruction.instructions,
            enabled: instruction.enabled,
            createdAt: timestamp,
            updatedAt: timestamp
          }))
        });
      }
    });
    return this.getProjectReviewConfig(userId, projectId);
  }

  async getGitlabProjectByGitlabId(gitlabHost: string, gitlabProjectId: string): Promise<GitlabProjectRow | null> {
    const row = await this.db.gitlabProject.findUnique({
      where: {
        gitlabHost_gitlabProjectId: {
          gitlabHost,
          gitlabProjectId
        }
      }
    });
    return row ? gitlabProjectFromRow(row) : null;
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

  async getSharedProjectGroup(gitlabProjectRefId: number): Promise<SharedProjectGroup | null> {
    const groups = await this.listSharedProjectGroups();
    return groups.find((group) => group.gitlabProject.id === gitlabProjectRefId) ?? null;
  }

  async deleteProject(userId: number, id: number): Promise<void> {
    await this.db.project.deleteMany({ where: { id } });
  }

  async countProjectSubscriptions(gitlabProjectRefId: number): Promise<number> {
    return this.db.project.count({ where: { gitlabProjectRefId } });
  }

  async getProject(userId: number, id: number): Promise<ProjectRow> {
    const row = await this.db.project.findFirst({ where: { id }, include: { gitlabProject: true } });
    if (!row) throw new Error("Project not found");
    return projectFromRow(row);
  }

  async findProjectByGitlabId(userId: number, gitlabProjectId: string): Promise<ProjectRow | null> {
    const row = await this.db.project.findFirst({ where: { gitlabProjectId }, include: { gitlabProject: true } });
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
      return {
        gitlabProject: gitlabProjectFromRow(entry.gitlabProject),
        subscriptions: entry.subscriptions,
        representative,
        skipLabels: uniqueNonEmpty(entry.subscriptions.flatMap((project) => project.skipLabels)),
        mrTargetBranches: uniqueNonEmpty(entry.subscriptions.flatMap((project) => project.mrTargetBranches)),
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
    const timestamp = nowIso();
    const existing = await this.db.mergeRequest.findFirst({ where: { gitlabProjectRefId, mrIid: mr.iid } });
    const data = {
      projectId: representativeProjectId,
      title: mr.title,
      webUrl: mr.web_url,
      authorUsername: mr.author?.username ?? null,
      labelsJson: JSON.stringify(mr.labels ?? []),
      headSha: mr.sha,
      state: mr.state,
      draft: mr.draft,
      updatedAtGitlab: mr.updated_at,
      observedAt: timestamp
    };
    if (existing) {
      await this.db.mergeRequest.update({
        where: { id: existing.id },
        data
      });
      return;
    }

    await this.db.mergeRequest.create({
      data: {
        ...data,
        gitlabProjectRefId,
        mrIid: mr.iid
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

  async findSharedRun(gitlabProjectRefId: number, mrIid: number, headSha: string): Promise<ReviewRunRow | null> {
    const row = await this.db.reviewRun.findFirst({
      where: { gitlabProjectRefId, mrIid, headSha },
      include: { project: true }
    });
    return row ? reviewRunFromRow(row, row.project) : null;
  }

  async getRunForSha(projectId: number, mrIid: number, headSha: string): Promise<ReviewRunRow | null> {
    const row = await this.db.reviewRun.findFirst({
      where: { projectId, mrIid, headSha },
      include: { project: true }
    });
    return row ? reviewRunFromRow(row, row.project) : null;
  }

  async getRunById(userId: number, id: number): Promise<ReviewRunRow | null> {
    const row = await this.db.reviewRun.findFirst({
      where: { id },
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
    comment: { id: number | null; url: string | null } | null = null,
    structuredReview: StructuredReview | null = null
  ): Promise<void> {
    await this.db.reviewRun.update({
      where: { id: runId },
      data: {
        status: "no_findings",
        finishedAt: nowIso(),
        commentId: comment?.id ?? null,
        commentUrl: comment?.url ?? null,
        findingsMarkdown: markdown,
        structuredReviewJson: structuredReview ? JSON.stringify(structuredReview) : null,
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

  async cancelRun(userId: number, runId: number): Promise<ReviewRunRow> {
    const run = await this.getRunById(userId, runId);
    if (!run) throw new Error("Review run not found");
    if (!isCancelableRunStatus(run.status)) throw new Error("Review run cannot be canceled");

    const timestamp = nowIso();
    await this.db.reviewRun.update({
      where: { id: runId },
      data: {
        status: "canceled",
        finishedAt: timestamp,
        errorMessage: null
      }
    });
    await this.cancelJobsForRun("mr", runId, timestamp);
    const updated = await this.getRunById(userId, runId);
    if (!updated) throw new Error("Review run not found");
    return updated;
  }

  async finishCommented(runId: number, comment: { id: number; url: string | null }, markdown: string, structuredReview: StructuredReview | null = null): Promise<void> {
    await this.db.reviewRun.update({
      where: { id: runId },
      data: {
        status: "commented",
        finishedAt: nowIso(),
        commentId: comment.id,
        commentUrl: comment.url,
        findingsMarkdown: markdown,
        structuredReviewJson: structuredReview ? JSON.stringify(structuredReview) : null,
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
    const existing = await this.db.branchWatchState.findFirst({ where: { gitlabProjectRefId, branchName } });
    if (existing) {
      const row = await this.db.branchWatchState.update({
        where: { id: existing.id },
        data: {
          projectId: representativeProjectId,
          lastSeenSha,
          lastError,
          updatedAt: timestamp
        }
      });
      return branchWatchStateFromRow(row);
    }

    const row = await this.db.branchWatchState.create({
      data: {
        projectId: representativeProjectId,
        gitlabProjectRefId,
        branchName,
        lastSeenSha,
        lastError,
        createdAt: timestamp,
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

  async findSharedCommitRun(gitlabProjectRefId: number, commitSha: string): Promise<CommitReviewRunView | null> {
    const row = await this.db.commitReviewRun.findFirst({
      where: { gitlabProjectRefId, commitSha },
      include: { project: true, gitlabProject: true }
    });
    return row ? commitReviewRunFromRow(row, row.project) : null;
  }

  async getCommitRunById(userId: number, id: number): Promise<CommitReviewRunView | null> {
    const row = await this.db.commitReviewRun.findFirst({
      where: { id },
      include: { project: true, gitlabProject: true }
    });
    return row ? commitReviewRunFromRow(row) : null;
  }

  async getCommitRunForSha(userId: number, gitlabProjectId: string, commitSha: string): Promise<CommitReviewRunView | null> {
    const row = await this.db.commitReviewRun.findFirst({
      where: { userId, gitlabProjectId, commitSha },
      include: { project: true, gitlabProject: true }
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
    status = "running",
    reviewStrategyOverride: ReviewStrategy | null = null
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
          reviewStrategyOverride,
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
        reviewStrategyOverride,
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
    status = "running",
    reviewStrategyOverride: ReviewStrategy | null = null
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
          reviewStrategyOverride,
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
        reviewStrategyOverride,
        status,
        startedAt: timestamp
      }
    });
    return row.id;
  }

  async finishCommitNoFindings(
    runId: number,
    markdown: string | null = null,
    comment: { id: number | null; url: string | null } | null = null,
    structuredReview: StructuredReview | null = null
  ): Promise<void> {
    await this.db.commitReviewRun.update({
      where: { id: runId },
      data: {
        status: "no_findings",
        finishedAt: nowIso(),
        commentId: comment?.id ?? null,
        commentUrl: comment?.url ?? null,
        findingsMarkdown: markdown,
        structuredReviewJson: structuredReview ? JSON.stringify(structuredReview) : null,
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

  async cancelCommitRun(userId: number, runId: number): Promise<CommitReviewRunView> {
    const run = await this.getCommitRunById(userId, runId);
    if (!run) throw new Error("Commit review run not found");
    if (!isCancelableRunStatus(run.status)) throw new Error("Commit review run cannot be canceled");

    const timestamp = nowIso();
    await this.db.commitReviewRun.update({
      where: { id: runId },
      data: {
        status: "canceled",
        finishedAt: timestamp,
        errorMessage: null
      }
    });
    await this.cancelJobsForRun("commit", runId, timestamp);
    const updated = await this.getCommitRunById(userId, runId);
    if (!updated) throw new Error("Commit review run not found");
    return updated;
  }

  async markRunCanceled(runType: ReviewRunType, runId: number): Promise<void> {
    const timestamp = nowIso();
    if (runType === "commit") {
      await this.db.commitReviewRun.updateMany({
        where: { id: runId, status: { in: ["queued", "running"] } },
        data: {
          status: "canceled",
          finishedAt: timestamp,
          errorMessage: null
        }
      });
      return;
    }
    await this.db.reviewRun.updateMany({
      where: { id: runId, status: { in: ["queued", "running"] } },
      data: {
        status: "canceled",
        finishedAt: timestamp,
        errorMessage: null
      }
    });
  }

  async finishCommitCommented(runId: number, comment: { id: number | null; url: string | null }, markdown: string, structuredReview: StructuredReview | null = null): Promise<void> {
    await this.db.commitReviewRun.update({
      where: { id: runId },
      data: {
        status: "commented",
        finishedAt: nowIso(),
        commentId: comment.id,
        commentUrl: comment.url,
        findingsMarkdown: markdown,
        structuredReviewJson: structuredReview ? JSON.stringify(structuredReview) : null,
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
        where: { status: "queued", updatedAt: { lte: nowIso() } },
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

  async heartbeatReviewJob(id: number): Promise<void> {
    await this.db.reviewJob.updateMany({
      where: { id, status: "running" },
      data: { updatedAt: nowIso() }
    });
  }

  async isReviewJobCanceled(id: number): Promise<boolean> {
    const row = await this.db.reviewJob.findUnique({
      where: { id },
      select: { status: true }
    });
    return row?.status === "canceled";
  }

  async recoverStaleRunningJobs(staleMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleMs).toISOString();
    const rows = await this.db.reviewJob.findMany({
      where: {
        status: "running",
        updatedAt: { lt: cutoff }
      },
      orderBy: { updatedAt: "asc" }
    });

    for (const row of rows) {
      const timestamp = nowIso();
      await this.db.reviewJob.updateMany({
        where: { id: row.id, status: "running" },
        data: {
          status: "queued",
          updatedAt: timestamp,
          startedAt: null,
          errorMessage: "Recovered stale running job after worker restart or heartbeat timeout"
        }
      });
      await this.releaseLocksForRecoveredJob(row, cutoff);

      if (row.runType === "commit" && row.runId) {
        await this.db.commitReviewRun.updateMany({
          where: { id: row.runId, status: "running" },
          data: {
            status: "queued",
            finishedAt: null,
            errorMessage: null
          }
        });
      }
      if (row.runType === "mr" && row.runId) {
        await this.db.reviewRun.updateMany({
          where: { id: row.runId, status: "running" },
          data: {
            status: "queued",
            finishedAt: null,
            errorMessage: null
          }
        });
      }
      if ((row.runType === "commit" || row.runType === "mr") && row.runId) {
        await this.addReviewEvent({
          runType: row.runType,
          runId: row.runId,
          level: "warn",
          step: "job_recovered",
          message: "Worker recovered a stale running review job and queued it again.",
          metadata: {
            jobId: row.id,
            kind: row.kind,
            previousUpdatedAt: row.updatedAt,
            staleSeconds: Math.round(staleMs / 1000)
          }
        });
      }
    }

    return rows.length;
  }

  private async releaseLocksForRecoveredJob(job: ReviewJob, staleCutoff: string): Promise<void> {
    await this.releaseLocksForJob(job, staleCutoff);
  }

  private async releaseLocksForJob(job: ReviewJob, staleCutoff?: string): Promise<void> {
    const payload = parseJsonRecord(job.payloadJson);
    const gitlabProjectRefId = numberFromMetadata(payload, "gitlabProjectRefId");
    const gitlabProjectId = stringFromMetadata(payload, "gitlabProjectId");
    const commitSha = stringFromMetadata(payload, "commitSha");
    const mrIid = numberFromMetadata(payload, "mrIid");
    const headSha = stringFromMetadata(payload, "headSha");
    const lockKeys = new Set<string>();

    if (gitlabProjectRefId) {
      const project = await this.db.gitlabProject.findUnique({ where: { id: gitlabProjectRefId } });
      if (project) {
        lockKeys.add(`project:${project.gitlabHost}:${project.gitlabProjectId}`);
        if (job.runType === "commit" && commitSha) lockKeys.add(`commit:${project.id}:${commitSha}`);
        if (job.runType === "mr" && mrIid && headSha) lockKeys.add(`mr:${project.id}:${mrIid}:${headSha}`);
      }
    }

    if (job.runType === "commit" && gitlabProjectId && commitSha) {
      lockKeys.add(`commit:${job.userId}:${gitlabProjectId}:${commitSha}`);
    }

    if (job.runType === "commit" && job.runId) {
      const run = await this.db.commitReviewRun.findUnique({ where: { id: job.runId } });
      if (run?.gitlabProjectRefId) {
        const project = await this.db.gitlabProject.findUnique({ where: { id: run.gitlabProjectRefId } });
        if (project) {
          lockKeys.add(`project:${project.gitlabHost}:${project.gitlabProjectId}`);
          lockKeys.add(`commit:${project.id}:${run.commitSha}`);
        }
      } else if (run) {
        lockKeys.add(`commit:${job.userId}:${run.gitlabProjectId}:${run.commitSha}`);
      }
    }

    if (job.runType === "mr" && job.runId) {
      const run = await this.db.reviewRun.findUnique({ where: { id: job.runId } });
      if (run?.gitlabProjectRefId) {
        const project = await this.db.gitlabProject.findUnique({ where: { id: run.gitlabProjectRefId } });
        if (project) {
          lockKeys.add(`project:${project.gitlabHost}:${project.gitlabProjectId}`);
          lockKeys.add(`mr:${project.id}:${run.mrIid}:${run.headSha}`);
        }
      } else if (run) {
        lockKeys.add(`${run.projectId}:${run.mrIid}:${run.headSha}`);
      }
    }

    const keys = [...lockKeys];
    if (!keys.length) return;
    await this.db.reviewLock.deleteMany({
      where: {
        lockKey: { in: keys },
        ...(staleCutoff ? { acquiredAt: { lt: staleCutoff } } : {})
      }
    });
  }

  async completeReviewJob(id: number): Promise<void> {
    const timestamp = nowIso();
    await this.db.reviewJob.updateMany({
      where: { id, status: { not: "canceled" } },
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
    await this.db.reviewJob.updateMany({
      where: { id, status: { not: "canceled" } },
      data: {
        status: "failed",
        updatedAt: timestamp,
        finishedAt: timestamp,
        errorMessage: error instanceof Error ? error.message : String(error)
      }
    });
  }

  async requeueReviewJob(id: number, reason: string | null = null, delayMs = 10_000): Promise<void> {
    await this.db.reviewJob.updateMany({
      where: { id, status: { not: "canceled" } },
      data: {
        status: "queued",
        updatedAt: new Date(Date.now() + delayMs).toISOString(),
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

  async addReviewFeedback(
    userId: number,
    runType: ReviewRunType,
    runId: number,
    input: { issueFingerprint: string; rating: ReviewFeedbackRating; note?: string | null }
  ): Promise<void> {
    const run = runType === "mr" ? await this.getRunById(userId, runId) : await this.getCommitRunById(userId, runId);
    if (!run) throw new Error("Review run not found");
    await this.db.reviewFeedback.upsert({
      where: {
        userId_runType_runId_issueFingerprint: {
          userId,
          runType,
          runId,
          issueFingerprint: input.issueFingerprint
        }
      },
      create: {
        userId,
        runType,
        runId,
        issueFingerprint: input.issueFingerprint,
        rating: input.rating,
        note: input.note?.trim() || null,
        createdAt: nowIso()
      },
      update: {
        rating: input.rating,
        note: input.note?.trim() || null,
        createdAt: nowIso()
      }
    });
    await this.addReviewEvent({
      runType,
      runId,
      level: "info",
      step: "review_feedback_recorded",
      message: "Review feedback recorded.",
      metadata: {
        issueFingerprint: input.issueFingerprint,
        rating: input.rating
      }
    });
  }

  async reviewQualityStats(userId: number): Promise<{
    feedbackCount: number;
    falsePositiveCount: number;
    canceledOrFailedCount: number;
    averageReviewSeconds: number | null;
  }> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [feedbackCount, falsePositiveCount, mrRuns, commitRuns] = await Promise.all([
      this.db.reviewFeedback.count({ where: { createdAt: { gte: since } } }),
      this.db.reviewFeedback.count({ where: { rating: "false_positive", createdAt: { gte: since } } }),
      this.db.reviewRun.findMany({
        where: {
          startedAt: { gte: since }
        },
        select: { status: true, startedAt: true, finishedAt: true }
      }),
      this.db.commitReviewRun.findMany({
        where: {
          startedAt: { gte: since }
        },
        select: { status: true, startedAt: true, finishedAt: true }
      })
    ]);
    const runs = [...mrRuns, ...commitRuns];
    const durations = runs
      .map((run) => run.finishedAt ? Date.parse(run.finishedAt) - Date.parse(run.startedAt) : null)
      .filter((duration): duration is number => typeof duration === "number" && Number.isFinite(duration) && duration >= 0);
    return {
      feedbackCount,
      falsePositiveCount,
      canceledOrFailedCount: runs.filter((run) => run.status === "failed" || run.status === "canceled").length,
      averageReviewSeconds: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length / 1000) : null
    };
  }

  private async cancelJobsForRun(runType: ReviewRunType, runId: number, timestamp = nowIso()): Promise<void> {
    const jobs = await this.db.reviewJob.findMany({
      where: {
        runType,
        runId,
        status: { in: ["queued", "running"] }
      }
    });

    await this.db.reviewJob.updateMany({
      where: {
        runType,
        runId,
        status: { in: ["queued", "running"] }
      },
      data: {
        status: "canceled",
        updatedAt: timestamp,
        finishedAt: timestamp,
        errorMessage: "Canceled by user"
      }
    });

    for (const job of jobs) {
      await this.releaseLocksForJob(job);
    }
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
    const userProjects = await this.db.project.findMany();
    const projectByRef = new Map<number, Project>();
    for (const project of userProjects) {
      if (project.gitlabProjectRefId) projectByRef.set(project.gitlabProjectRefId, project);
    }
    const rows = await this.db.mergeRequest.findMany({
      include: { project: true },
      orderBy: { observedAt: "desc" }
    });

    const runPairs = await Promise.all(
      rows.map(async (row) => ({
        row,
        run: row.headSha
          ? await this.db.reviewRun.findFirst({
              where: row.gitlabProjectRefId
                ? { gitlabProjectRefId: row.gitlabProjectRefId, mrIid: row.mrIid, headSha: row.headSha }
                : { projectId: row.projectId, mrIid: row.mrIid, headSha: row.headSha },
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
    const userProjects = await this.db.project.findMany();
    const projectByRef = new Map<number, Project>();
    for (const project of userProjects) {
      if (project.gitlabProjectRefId) projectByRef.set(project.gitlabProjectRefId, project);
    }
    const rows = await this.db.commitReviewRun.findMany({
      include: { project: true, gitlabProject: true },
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
    const [projectCount, mrCount, runningCount, failedCount, commentedCount] = await Promise.all([
      this.db.project.count({ where: { enabled: true } }),
      this.db.mergeRequest.count({
        where: {
          state: "opened"
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
    const [mergeRequestRuns, commitRuns] = await Promise.all([
      this.db.reviewRun.count({
        where: {
          status: { in: statuses }
        }
      }),
      this.db.commitReviewRun.count({
        where: {
          status: { in: statuses }
        }
      })
    ]);
    return mergeRequestRuns + commitRuns;
  }

  async clearReviewHistory(): Promise<void> {
    await this.db.reviewFeedback.deleteMany();
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
        current.reviewStrategy = stringFromMetadata(metadata, "reviewStrategy");
        current.triageUsed = booleanFromMetadata(metadata, "triageUsed");
        current.triageRiskLevel = stringFromMetadata(metadata, "triageRiskLevel");
        current.triageReason = stringFromMetadata(metadata, "triageReason");
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

function projectFromRow(row: Project & { gitlabProject?: GitlabProject | null }): ProjectRow {
  const gitlabProject = "gitlabProject" in row ? row.gitlabProject : null;
  return {
    id: row.id,
    userId: row.userId,
    gitlabProjectRefId: row.gitlabProjectRefId,
    gitlabProjectId: row.gitlabProjectId,
    displayName: row.displayName,
    webUrl: gitlabProject?.webUrl ?? null,
    enabled: row.enabled,
    skipLabels: parseJsonArray(row.skipLabelsJson),
    mrTargetBranches: parseJsonArray(row.mrTargetBranchesJson),
    commitBranches: parseJsonArray(row.commitBranchesJson),
    reviewStrategy: parseReviewStrategy(gitlabProject?.reviewStrategy),
    reviewStrategyUpdatedByUserId: gitlabProject?.reviewStrategyUpdatedByUserId ?? null,
    reviewStrategyUpdatedAt: gitlabProject?.reviewStrategyUpdatedAt ?? null,
    reviewProfile: parseReviewProfile(gitlabProject?.reviewProfile),
    pathFilters: parseJsonArray(gitlabProject?.pathFiltersJson ?? JSON.stringify(defaultPathFilters())),
    webhookStatus: webhookStatus(gitlabProject ?? null),
    webhookUrl: gitlabProject?.webhookUrl ?? null,
    webhookLastVerifiedAt: gitlabProject?.webhookLastVerifiedAt ?? null,
    webhookError: gitlabProject?.webhookError ?? null
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
    webhookHookId: row.webhookHookId,
    webhookSecretEncrypted: row.webhookSecretEncrypted,
    webhookUrl: row.webhookUrl,
    webhookLastVerifiedAt: row.webhookLastVerifiedAt,
    webhookError: row.webhookError,
    reviewStrategy: parseReviewStrategy(row.reviewStrategy),
    reviewStrategyUpdatedByUserId: row.reviewStrategyUpdatedByUserId,
    reviewStrategyUpdatedAt: row.reviewStrategyUpdatedAt,
    reviewProfile: parseReviewProfile(row.reviewProfile),
    pathFilters: parseJsonArray(row.pathFiltersJson),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function reviewConfigFromProject(
  project: GitlabProject & { reviewInstructions?: PrismaProjectReviewInstruction[] },
  instructions: PrismaProjectReviewInstruction[] = []
): ProjectReviewConfig {
  const pathFilters = parseJsonArray(project.pathFiltersJson);
  return {
    reviewProfile: parseReviewProfile(project.reviewProfile),
    pathFilters: pathFilters.length ? pathFilters : defaultPathFilters(),
    instructions: instructions.map((instruction) => ({
      id: instruction.id,
      pathGlob: instruction.pathGlob,
      instructions: instruction.instructions,
      enabled: instruction.enabled
    }))
  };
}

function webhookStatus(project: GitlabProject | null): ProjectRow["webhookStatus"] {
  if (!project) return "missing";
  if (project.webhookError) return "error";
  if (project.webhookHookId && project.webhookSecretEncrypted) return "connected";
  return "missing";
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
    structuredReview: parseStructuredReviewJson(row.structuredReviewJson),
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
    structuredReview: parseStructuredReviewJson(run?.structuredReviewJson ?? null),
    errorMessage: run?.errorMessage ?? null,
    reviewMeta
  };
}

function commitReviewRunFromRow(
  row: CommitReviewRun & { project?: Project | null; gitlabProject?: GitlabProject | null },
  displayProject = row.project,
  reviewMeta: ReviewMeta | null = null
): CommitReviewRunView {
  return {
    id: row.id,
    userId: row.userId,
    projectId: row.projectId,
    gitlabProjectRefId: row.gitlabProjectRefId,
    gitlabProjectId: row.gitlabProjectId,
    projectName: displayProject?.displayName ?? row.gitlabProject?.nameWithNamespace ?? row.gitlabProject?.pathWithNamespace ?? row.gitlabProjectId,
    branchName: row.branchName,
    commitSha: row.commitSha,
    commitTitle: row.commitTitle,
    commitUrl: row.commitUrl,
    authorName: row.authorName,
    committedDate: row.committedDate,
    trigger: row.trigger,
    reviewStrategyOverride: row.reviewStrategyOverride ? parseReviewStrategy(row.reviewStrategyOverride) : null,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    commentId: row.commentId,
    commentUrl: row.commentUrl,
    findingsMarkdown: row.findingsMarkdown,
    structuredReview: parseStructuredReviewJson(row.structuredReviewJson),
    errorMessage: row.errorMessage,
    reviewMeta
  };
}

function parseStructuredReviewJson(value: string | null | undefined): StructuredReview | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as StructuredReview;
  } catch {
    return null;
  }
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
  return (
    value === "commit_manual" ||
    value === "commit_retry" ||
    value === "mr_retry" ||
    value === "scan_user" ||
    value === "commit_webhook" ||
    value === "mr_webhook"
  );
}

function isReviewJobStatus(value: string): value is ReviewJobStatus {
  return value === "queued" || value === "running" || value === "completed" || value === "failed" || value === "canceled";
}

function isCancelableRunStatus(value: string): boolean {
  return value === "queued" || value === "running";
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
    reviewStrategy: null,
    triageUsed: null,
    triageRiskLevel: null,
    triageReason: null,
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

function booleanFromMetadata(metadata: Record<string, unknown>, key: string): boolean | null {
  const value = metadata[key];
  return typeof value === "boolean" ? value : null;
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
