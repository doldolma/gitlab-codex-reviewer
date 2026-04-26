export type UserRole = "admin" | "user";
export type CodexReviewReasoningEffort = "minimal" | "low" | "medium" | "high" | "xhigh";
export type ReviewStrategy = "auto" | "fast" | "balanced" | "thorough";

export type AuthStatus = {
  authenticated: boolean;
  currentUser: null | { userId: number; gitlabHost: string; gitlabUserId: number; username: string; role: UserRole };
  gitlab: null | { gitlabHost: string; gitlabUserId: number; username: string; expiresAt: string };
  oauthConfigured: boolean;
};

export type CodexStatus = {
  authenticated: boolean;
  requiresOpenaiAuth: boolean;
  authMode: string | null;
  email: string | null;
  planType: string | null;
  reviewModel: string;
  reviewStrategyMode: "project";
  managedByAdmin?: boolean;
  error?: string;
};

export type CodexLoginStart =
  | { type: "browser"; loginId: string; authUrl: string }
  | { type: "device"; loginId: string; verificationUrl: string; userCode: string };

export type ReviewerBotStatus = {
  connected: boolean;
  gitlabHost: string | null;
  botUserId: number | null;
  username: string | null;
  name: string | null;
  lastVerifiedAt: string | null;
};

export type CodexReviewSettings = {
  model: string;
  isDefault: boolean;
  updatedByUserId: number | null;
  updatedAt: string | null;
  defaults: {
    model: string;
  };
  modelPresets: string[];
  strategyMode: "project";
};

export type AdminUser = {
  id: number;
  gitlabHost: string;
  gitlabUserId: number;
  username: string;
  name: string | null;
  webUrl: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};

export type Project = {
  id: number;
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
  webhookStatus: "connected" | "error" | "missing";
  webhookUrl: string | null;
  webhookLastVerifiedAt: string | null;
  webhookError: string | null;
};

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

export type MergeRequest = {
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

export type CommitReview = {
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
  trigger: "auto" | "manual" | string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  commentId: number | null;
  commentUrl: string | null;
  findingsMarkdown: string | null;
  errorMessage: string | null;
  reviewMeta: ReviewMeta | null;
};

export type ReviewEvent = {
  id: number;
  runType: "mr" | "commit";
  runId: number;
  level: "info" | "warn" | "error";
  step: string;
  message: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ReviewJob = {
  id: number;
  kind: "commit_manual" | "commit_retry" | "mr_retry" | "scan_user" | "commit_webhook" | "mr_webhook" | string;
  status: "queued" | "running" | "completed" | "failed" | string;
  userId: number;
  runType: "mr" | "commit" | null;
  runId: number | null;
  payload: Record<string, unknown>;
  attempts: number;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type GitLabProjectOption = {
  id: number;
  pathWithNamespace: string;
  nameWithNamespace: string;
  webUrl: string | null;
  cloneHttpUrl: string | null;
  defaultBranch: string | null;
};

export type GitLabBranchOption = {
  name: string;
  default: boolean;
  protected: boolean;
  webUrl: string | null;
};

export type GitLabCommitOption = {
  sha: string;
  shortSha: string;
  title: string;
  webUrl: string | null;
  authorName: string | null;
  committedDate: string | null;
};

export type Dashboard = {
  stats: {
    projectCount: number;
    mrCount: number;
    runningCount: number;
    failedCount: number;
    commentedCount: number;
  };
  gitlab: AuthStatus["gitlab"];
  currentUser: AuthStatus["currentUser"];
  recentMergeRequests: MergeRequest[];
};

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "include" });
  return handleResponse<T>(response);
}

export async function apiSend<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...options,
    credentials: "include",
    headers: {
      "content-type": "application/json",
      ...(options.headers ?? {})
    }
  });
  return handleResponse<T>(response);
}

async function handleResponse<T>(response: Response): Promise<T> {
  if (response.status === 401) {
    window.location.assign("/login");
    throw new Error("Authentication required");
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(data.error ?? `Request failed with ${response.status}`);
  }
  return data as T;
}
