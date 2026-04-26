import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../../../lib/api-helpers";
import { isAuthFailure, requireSessionUser } from "../../../../../lib/session";
import { reviewState } from "../../../../../lib/services";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ id: string }> };

const feedbackInput = z.object({
  issueFingerprint: z.string().min(1),
  rating: z.enum(["helpful", "false_positive", "too_minor", "missed_issue"]),
  note: z.string().optional().nullable()
});

export async function POST(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    const input = feedbackInput.parse(await readJson(request));
    await reviewState.addReviewFeedback(user.id, "mr", Number(id), input);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
