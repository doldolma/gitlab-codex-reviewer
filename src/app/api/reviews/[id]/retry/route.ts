import { NextResponse } from "next/server";
import { jsonError } from "../../../../../lib/api-helpers";
import { isAuthFailure, requireSessionUser } from "../../../../../lib/session";
import { reviewWorker } from "../../../../../lib/services";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    const result = await reviewWorker.enqueueRetryRun(user.id, Number(id));
    return NextResponse.json({ ok: true, reviewRun: result.run, job: result.job }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
