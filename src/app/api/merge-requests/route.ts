import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUser } from "../../../lib/session";
import { reviewState } from "../../../lib/services";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;
  return NextResponse.json({ mergeRequests: await reviewState.listMergeRequestViews(user.id) });
}
