import { NextResponse } from "next/server";
import { jsonError } from "../../../../../../lib/api-helpers";
import { isAuthFailure, requireAdminUser } from "../../../../../../lib/session";
import { gitlabWebhooks, reviewState } from "../../../../../../lib/services";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const user = await requireAdminUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    const project = await reviewState.getProject(user.id, Number(id));
    if (!project.gitlabProjectRefId) throw new Error("Shared GitLab project metadata is not available");
    const gitlabProject = await gitlabWebhooks.resetProjectWebhook(project.gitlabProjectRefId);
    return NextResponse.json({ gitlabProject });
  } catch (error) {
    return jsonError(error);
  }
}
