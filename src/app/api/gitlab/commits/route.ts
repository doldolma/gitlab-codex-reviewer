import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "../../../../lib/api-helpers";
import { GitLabClient } from "../../../../lib/gitlab-client";
import { isAuthFailure, requireSessionUser } from "../../../../lib/session";
import { gitlabOAuth } from "../../../../lib/services";

export const runtime = "nodejs";

const querySchema = z.object({
  projectId: z.string().min(1),
  branchName: z.string().min(1)
});

export async function GET(request: Request) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      projectId: url.searchParams.get("projectId") ?? "",
      branchName: url.searchParams.get("branchName") ?? ""
    });
    const connection = await gitlabOAuth.getValidConnection(user.id);
    if (!connection) return NextResponse.json({ error: "GitLab is not connected" }, { status: 400 });

    const commits = await new GitLabClient(connection).listCommits(input.projectId, input.branchName);
    return NextResponse.json({
      commits: commits.map((commit) => ({
        sha: commit.id,
        shortSha: commit.short_id ?? commit.id.slice(0, 8),
        title: commit.title ?? commit.message?.split("\n")[0] ?? commit.id.slice(0, 8),
        webUrl: commit.web_url ?? null,
        authorName: commit.author_name ?? null,
        committedDate: commit.committed_date ?? commit.created_at ?? null
      }))
    });
  } catch (error) {
    return jsonError(error);
  }
}
