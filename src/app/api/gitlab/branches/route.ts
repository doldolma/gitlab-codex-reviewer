import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError } from "../../../../lib/api-helpers";
import { GitLabClient } from "../../../../lib/gitlab-client";
import { isAuthFailure, requireSessionUser } from "../../../../lib/session";
import { gitlabOAuth } from "../../../../lib/services";

export const runtime = "nodejs";

const querySchema = z.object({
  projectId: z.string().min(1),
  search: z.string().optional()
});

export async function GET(request: Request) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const url = new URL(request.url);
    const input = querySchema.parse({
      projectId: url.searchParams.get("projectId") ?? "",
      search: url.searchParams.get("search") ?? undefined
    });
    const connection = await gitlabOAuth.getValidConnection(user.id);
    if (!connection) return NextResponse.json({ error: "GitLab is not connected" }, { status: 400 });

    const branches = await new GitLabClient(connection).listBranches(input.projectId, input.search);
    return NextResponse.json({
      branches: branches.map((branch) => ({
        name: branch.name,
        default: branch.default,
        protected: branch.protected,
        webUrl: branch.web_url ?? null
      }))
    });
  } catch (error) {
    return jsonError(error);
  }
}
