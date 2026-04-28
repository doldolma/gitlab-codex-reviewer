import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../../../../lib/api-helpers";
import { isAuthFailure, requireSessionUser } from "../../../../../../lib/session";
import { reviewState } from "../../../../../../lib/services";

export const runtime = "nodejs";

const releaseNotesContextInput = z.object({
  context: z.string().max(20_000).default("")
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    return NextResponse.json(await reviewState.getProjectReleaseNotesContext(user.id, Number(id)));
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    const input = releaseNotesContextInput.parse(await readJson(request));
    return NextResponse.json(await reviewState.updateProjectReleaseNotesContext(user.id, Number(id), input.context));
  } catch (error) {
    return jsonError(error);
  }
}
