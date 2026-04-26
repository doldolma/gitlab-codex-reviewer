import { NextResponse } from "next/server";
import { jsonError } from "../../../../lib/api-helpers";
import { isAuthFailure, requireSessionUser } from "../../../../lib/session";
import { reviewWorker } from "../../../../lib/services";

export const runtime = "nodejs";

export async function POST() {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const job = await reviewWorker.enqueueScan(user.id);
    return NextResponse.json({ queued: true, job }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
