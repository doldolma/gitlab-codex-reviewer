import { NextResponse } from "next/server";
import { jsonError } from "../../../../../../lib/api-helpers";
import { isAuthFailure, requireSessionUser } from "../../../../../../lib/session";
import { reviewState } from "../../../../../../lib/services";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ entryId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { entryId } = await context.params;
    return NextResponse.json({ events: await reviewState.listReviewEvents(user.id, "release_note", Number(entryId)) });
  } catch (error) {
    const status = error instanceof Error && error.message.includes("not found") ? 404 : undefined;
    return jsonError(error, status);
  }
}
