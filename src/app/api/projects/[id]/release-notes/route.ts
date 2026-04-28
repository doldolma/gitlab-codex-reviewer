import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../../../lib/api-helpers";
import { isAuthFailure, requireSessionUser } from "../../../../../lib/session";
import { gitlabWebhooks, reviewState } from "../../../../../lib/services";

export const runtime = "nodejs";

const releaseNotesInput = z.object({
  enabled: z.boolean()
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    const input = releaseNotesInput.parse(await readJson(request));
    const project = await reviewState.updateGitlabProjectReleaseNotesEnabled(user.id, Number(id), input.enabled);
    if (input.enabled && project.gitlabProjectRefId) {
      await gitlabWebhooks.ensureProjectWebhook(await reviewState.getGitlabProject(project.gitlabProjectRefId));
    }
    return NextResponse.json({
      project: await reviewState.getProject(user.id, Number(id))
    });
  } catch (error) {
    return jsonError(error);
  }
}
