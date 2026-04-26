import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../../../lib/api-helpers";
import { isAuthFailure, requireSessionUser } from "../../../../../lib/session";
import { reviewState } from "../../../../../lib/services";
import { REVIEW_STRATEGIES } from "../../../../../lib/review-strategy";

export const runtime = "nodejs";

const strategyInput = z.object({
  reviewStrategy: z.enum(REVIEW_STRATEGIES)
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    const input = strategyInput.parse(await readJson(request));
    return NextResponse.json({
      project: await reviewState.updateGitlabProjectReviewStrategy(user.id, Number(id), input.reviewStrategy)
    });
  } catch (error) {
    return jsonError(error);
  }
}
