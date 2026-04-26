import { NextResponse } from "next/server";
import { jsonError } from "../../../../../lib/api-helpers";
import { isAuthFailure, requireSessionUser } from "../../../../../lib/session";
import { reviewState } from "../../../../../lib/services";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    return NextResponse.json({ events: await reviewState.listReviewEvents(user.id, "commit", Number(id)) });
  } catch (error) {
    return jsonError(error);
  }
}
