import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../../../lib/api-helpers";
import { REVIEW_PROFILES } from "../../../../../lib/review-config";
import { isAuthFailure, requireSessionUser } from "../../../../../lib/session";
import { reviewState } from "../../../../../lib/services";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const instructionInput = z.object({
  id: z.number().optional(),
  pathGlob: z.string().min(1),
  instructions: z.string().min(1),
  enabled: z.boolean().default(true)
});

const reviewConfigInput = z.object({
  reviewProfile: z.enum(REVIEW_PROFILES).default("assertive"),
  pathFilters: z.array(z.string()).default([]),
  instructions: z.array(instructionInput).default([])
});

export async function GET(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    return NextResponse.json({ config: await reviewState.getProjectReviewConfig(user.id, Number(id)) });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    const input = reviewConfigInput.parse(await readJson(request));
    return NextResponse.json({ config: await reviewState.updateProjectReviewConfig(user.id, Number(id), input) });
  } catch (error) {
    return jsonError(error);
  }
}
