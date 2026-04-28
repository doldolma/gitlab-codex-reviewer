import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "../../../../lib/api-helpers";
import { GitLabClient } from "../../../../lib/gitlab-client";
import { isAuthFailure, requireSessionUser } from "../../../../lib/session";
import { gitlabOAuth } from "../../../../lib/services";

export const runtime = "nodejs";

const querySchema = z.object({
  projectId: z.string().min(1)
});

export async function GET(request: Request) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const url = new URL(request.url);
    const input = querySchema.parse({ projectId: url.searchParams.get("projectId") ?? "" });
    const connection = await gitlabOAuth.getValidConnection(user.id);
    if (!connection) return NextResponse.json({ error: "GitLab is not connected" }, { status: 400 });

    const client = new GitLabClient(connection);
    const [project, tags] = await Promise.all([
      client.getProject(input.projectId),
      client.listTags(input.projectId)
    ]);
    return NextResponse.json({
      tags: tags.filter((tag) => tag.name.startsWith("v")).map((tag) => ({
        name: tag.name,
        target: tag.target ?? null,
        message: tag.message ?? null,
        commitSha: tag.commit?.id ?? null,
        createdAt: tag.created_at ?? tag.commit?.committed_date ?? tag.commit?.created_at ?? null,
        webUrl: tag.web_url ?? tagWebUrl(project.web_url ?? null, tag.name)
      }))
    });
  } catch (error) {
    return jsonError(error);
  }
}

function tagWebUrl(projectWebUrl: string | null, tagName: string): string | null {
  if (!projectWebUrl) return null;
  return `${projectWebUrl.replace(/\/$/, "")}/-/tags/${encodeURIComponent(tagName)}`;
}
