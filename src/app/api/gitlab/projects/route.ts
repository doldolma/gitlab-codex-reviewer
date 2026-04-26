import { NextResponse } from "next/server";
import { jsonError } from "../../../../lib/api-helpers";
import { GitLabClient } from "../../../../lib/gitlab-client";
import { isAuthFailure, requireSessionUser } from "../../../../lib/session";
import { gitlabOAuth } from "../../../../lib/services";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const connection = await gitlabOAuth.getValidConnection(user.id);
    if (!connection) return NextResponse.json({ error: "GitLab is not connected" }, { status: 400 });

    const search = new URL(request.url).searchParams.get("search") ?? undefined;
    const projects = await new GitLabClient(connection).listProjects(search);
    return NextResponse.json({
      projects: projects.map((project) => ({
        id: project.id,
        pathWithNamespace: project.path_with_namespace,
        nameWithNamespace: project.name_with_namespace,
        webUrl: project.web_url ?? null,
        cloneHttpUrl: project.http_url_to_repo ?? null,
        defaultBranch: project.default_branch ?? null
      }))
    });
  } catch (error) {
    return jsonError(error);
  }
}
