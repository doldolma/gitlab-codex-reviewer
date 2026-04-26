import type { GitLabConnection } from "./gitlab-oauth";

export type GitLabMergeRequest = {
  iid: number;
  title: string;
  web_url: string;
  sha: string | null;
  target_branch?: string;
  source_branch?: string;
  labels: string[];
  draft: boolean;
  work_in_progress?: boolean;
  state: string;
  updated_at: string;
  author?: { username?: string };
};

export type GitLabDiff = {
  old_path: string;
  new_path: string;
  a_mode?: string;
  b_mode?: string;
  new_file: boolean;
  renamed_file: boolean;
  deleted_file: boolean;
  generated_file?: boolean;
  collapsed?: boolean;
  too_large?: boolean;
  diff: string;
};

export type GitLabNote = {
  id: number;
  body: string;
  web_url?: string;
};

export type GitLabCommit = {
  id: string;
  short_id?: string;
  title?: string;
  message?: string;
  web_url?: string;
  author_name?: string;
  committed_date?: string;
  created_at?: string;
  parent_ids?: string[];
};

export type GitLabCommitComment = {
  id?: number;
  note: string;
  web_url?: string;
};

export type GitLabProject = {
  id: number;
  path_with_namespace: string;
  name_with_namespace: string;
  web_url?: string;
  http_url_to_repo?: string;
  default_branch?: string | null;
};

export type GitLabBranch = {
  name: string;
  default: boolean;
  protected: boolean;
  web_url?: string;
};

type GitLabCompareResponse = {
  commits?: GitLabCommit[];
};

export class GitLabClient {
  constructor(private readonly connection: GitLabConnection) {}

  async listProjects(search?: string): Promise<GitLabProject[]> {
    return this.request<GitLabProject[]>("/api/v4/projects", {
      method: "GET",
      params: {
        simple: "true",
        order_by: "last_activity_at",
        sort: "desc",
        per_page: "20",
        ...(search?.trim() ? { search: search.trim() } : {})
      }
    });
  }

  async getProject(projectId: string): Promise<GitLabProject> {
    return this.request<GitLabProject>(`/api/v4/projects/${encodeProjectId(projectId)}`, {
      method: "GET"
    });
  }

  async listBranches(projectId: string, search?: string): Promise<GitLabBranch[]> {
    const branches = await this.paginate<GitLabBranch>(`/api/v4/projects/${encodeProjectId(projectId)}/repository/branches`, {
      per_page: "100",
      ...(search?.trim() ? { search: search.trim() } : {})
    });
    return sortBranches(branches);
  }

  async listOpenedMergeRequests(projectId: string, targetBranch?: string): Promise<GitLabMergeRequest[]> {
    return this.paginate<GitLabMergeRequest>(`/api/v4/projects/${encodeProjectId(projectId)}/merge_requests`, {
      state: "opened",
      wip: "no",
      per_page: "100",
      order_by: "updated_at",
      sort: "desc",
      ...(targetBranch ? { target_branch: targetBranch } : {})
    });
  }

  async listMergeRequestDiffs(projectId: string, mrIid: number): Promise<GitLabDiff[]> {
    return this.paginate<GitLabDiff>(`/api/v4/projects/${encodeProjectId(projectId)}/merge_requests/${mrIid}/diffs`, {
      unidiff: "true",
      per_page: "100"
    });
  }

  async listMergeRequestNotes(projectId: string, mrIid: number): Promise<GitLabNote[]> {
    return this.paginate<GitLabNote>(`/api/v4/projects/${encodeProjectId(projectId)}/merge_requests/${mrIid}/notes`, {
      per_page: "100",
      order_by: "created_at",
      sort: "desc"
    });
  }

  async createMergeRequestNote(projectId: string, mrIid: number, body: string): Promise<GitLabNote> {
    return this.request<GitLabNote>(`/api/v4/projects/${encodeProjectId(projectId)}/merge_requests/${mrIid}/notes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body })
    });
  }

  async getLatestCommit(projectId: string, branchName: string): Promise<GitLabCommit | null> {
    const commits = await this.request<GitLabCommit[]>(`/api/v4/projects/${encodeProjectId(projectId)}/repository/commits`, {
      method: "GET",
      params: {
        ref_name: branchName,
        per_page: "1"
      }
    });
    return commits[0] ?? null;
  }

  async listCommits(projectId: string, branchName: string, perPage = 30): Promise<GitLabCommit[]> {
    return this.request<GitLabCommit[]>(`/api/v4/projects/${encodeProjectId(projectId)}/repository/commits`, {
      method: "GET",
      params: {
        ref_name: branchName,
        per_page: String(perPage)
      }
    });
  }

  async getCommit(projectId: string, sha: string): Promise<GitLabCommit> {
    return this.request<GitLabCommit>(`/api/v4/projects/${encodeProjectId(projectId)}/repository/commits/${encodeURIComponent(sha)}`, {
      method: "GET"
    });
  }

  async compareCommits(projectId: string, from: string, to: string): Promise<GitLabCommit[]> {
    const compare = await this.request<GitLabCompareResponse>(
      `/api/v4/projects/${encodeProjectId(projectId)}/repository/compare`,
      {
        method: "GET",
        params: {
          from,
          to,
          straight: "true"
        }
      }
    );
    return compare.commits ?? [];
  }

  async listCommitDiffs(projectId: string, sha: string): Promise<GitLabDiff[]> {
    return this.paginate<GitLabDiff>(`/api/v4/projects/${encodeProjectId(projectId)}/repository/commits/${encodeURIComponent(sha)}/diff`, {
      unidiff: "true",
      per_page: "100"
    });
  }

  async listCommitComments(projectId: string, sha: string): Promise<GitLabCommitComment[]> {
    return this.paginate<GitLabCommitComment>(
      `/api/v4/projects/${encodeProjectId(projectId)}/repository/commits/${encodeURIComponent(sha)}/comments`,
      {
        per_page: "100"
      }
    );
  }

  async createCommitComment(projectId: string, sha: string, note: string): Promise<GitLabCommitComment> {
    return this.request<GitLabCommitComment>(
      `/api/v4/projects/${encodeProjectId(projectId)}/repository/commits/${encodeURIComponent(sha)}/comments`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note })
      }
    );
  }

  private async paginate<T>(path: string, params: Record<string, string>): Promise<T[]> {
    const results: T[] = [];
    let page = 1;
    for (;;) {
      const url = new URL(path, this.connection.gitlabHost);
      for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
      url.searchParams.set("page", String(page));

      const response = await this.rawRequest(url, { method: "GET" });
      const items = (await response.json()) as T[];
      results.push(...items);

      const nextPage = response.headers.get("x-next-page");
      if (!nextPage) break;
      page = Number(nextPage);
    }
    return results;
  }

  private async request<T>(path: string, init: RequestInit & { params?: Record<string, string> }): Promise<T> {
    const url = new URL(path, this.connection.gitlabHost);
    for (const [key, value] of Object.entries(init.params ?? {})) url.searchParams.set(key, value);
    const { params: _params, ...requestInit } = init;
    const response = await this.rawRequest(url, requestInit);
    return (await response.json()) as T;
  }

  private async rawRequest(url: URL, init: RequestInit): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.connection.authType === "private-token") {
      headers.set("PRIVATE-TOKEN", this.connection.accessToken);
    } else {
      headers.set("authorization", `Bearer ${this.connection.accessToken}`);
    }
    const response = await fetch(url, {
      ...init,
      headers
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`GitLab API ${init.method ?? "GET"} ${url.pathname} failed with ${response.status}: ${text.slice(0, 300)}`);
    }
    return response;
  }
}

function encodeProjectId(projectId: string): string {
  return encodeURIComponent(projectId);
}

function sortBranches(branches: GitLabBranch[]): GitLabBranch[] {
  return [...branches].sort((left, right) => {
    if (left.default !== right.default) return left.default ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}
