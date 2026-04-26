import { afterEach, describe, expect, it, vi } from "vitest";
import { GitLabClient } from "../lib/gitlab-client";
import type { GitLabConnection } from "../lib/gitlab-oauth";

const connection: GitLabConnection = {
  userId: 1,
  gitlabHost: "https://gitlab.example.com",
  gitlabUserId: 100,
  username: "alice",
  accessToken: "access-token",
  refreshToken: "refresh-token",
  expiresAt: new Date(Date.now() + 60_000).toISOString()
};

describe("GitLabClient discovery helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches accessible projects without forcing membership scope", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe("/api/v4/projects");
      expect(requestUrl.searchParams.get("simple")).toBe("true");
      expect(requestUrl.searchParams.get("order_by")).toBe("last_activity_at");
      expect(requestUrl.searchParams.get("sort")).toBe("desc");
      expect(requestUrl.searchParams.get("per_page")).toBe("20");
      expect(requestUrl.searchParams.get("search")).toBe("reviewer");
      expect(requestUrl.searchParams.has("membership")).toBe(false);
      return new Response(
        JSON.stringify([
          {
            id: 7,
            path_with_namespace: "group/reviewer",
            name_with_namespace: "Group / Reviewer",
            web_url: "https://gitlab.example.com/group/reviewer",
            default_branch: "main"
          }
        ]),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const projects = await new GitLabClient(connection).listProjects("reviewer");

    expect(projects[0]?.id).toBe(7);
  });

  it("lists branches with encoded project paths", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe("/api/v4/projects/group%2Freviewer/repository/branches");
      expect(requestUrl.searchParams.get("per_page")).toBe("100");
      expect(requestUrl.searchParams.get("search")).toBe("main");
      return new Response(JSON.stringify([{ name: "main", default: true, protected: true }]), {
        status: 200,
        headers: { "x-next-page": "" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const branches = await new GitLabClient(connection).listBranches("group/reviewer", "main");

    expect(branches[0]?.name).toBe("main");
  });

  it("orders the default branch before other branches", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { name: "release/1.0", default: false, protected: true },
            { name: "develop", default: false, protected: false },
            { name: "main", default: true, protected: true }
          ]),
          {
            status: 200,
            headers: { "x-next-page": "" }
          }
        )
      )
    );

    const branches = await new GitLabClient(connection).listBranches("group/reviewer");

    expect(branches.map((branch) => branch.name)).toEqual(["main", "develop", "release/1.0"]);
  });

  it("lists latest commits for a selected branch", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe("/api/v4/projects/group%2Freviewer/repository/commits");
      expect(requestUrl.searchParams.get("ref_name")).toBe("develop");
      expect(requestUrl.searchParams.get("per_page")).toBe("30");
      return new Response(JSON.stringify([{ id: "abc123", short_id: "abc123", title: "Fix issue" }]), {
        status: 200
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const commits = await new GitLabClient(connection).listCommits("group/reviewer", "develop");

    expect(commits[0]?.id).toBe("abc123");
  });

  it("creates project webhooks with push and merge request events enabled", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe("/api/v4/projects/123/hooks");
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({
        url: "https://reviewer.example.com/api/gitlab/webhook",
        token: "hook-secret",
        push_events: true,
        merge_requests_events: true,
        enable_ssl_verification: true,
        name: "GitLab Codex Reviewer"
      });
      return new Response(JSON.stringify({ id: 99, url: body.url }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const hook = await new GitLabClient(connection).createProjectHook("123", {
      url: "https://reviewer.example.com/api/gitlab/webhook",
      token: "hook-secret",
      name: "GitLab Codex Reviewer"
    });

    expect(hook.id).toBe(99);
  });

  it("deletes project webhooks", async () => {
    const fetchMock = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const requestUrl = new URL(String(url));
      expect(requestUrl.pathname).toBe("/api/v4/projects/123/hooks/99");
      expect(init?.method).toBe("DELETE");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-token");
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await new GitLabClient(connection).deleteProjectHook("123", 99);

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
