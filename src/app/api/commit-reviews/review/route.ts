import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../../lib/api-helpers";
import { isAuthFailure, requireSessionUser } from "../../../../lib/session";
import { reviewWorker } from "../../../../lib/services";

export const runtime = "nodejs";

const manualCommitReviewInput = z.object({
  gitlabProjectId: z.string().min(1),
  commitSha: z.string().min(1),
  branchName: z.string().optional()
});

export async function POST(request: Request) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const input = manualCommitReviewInput.parse(await readJson(request));
    const result = await reviewWorker.enqueueCommitReviewManually(user.id, {
      gitlabProjectId: input.gitlabProjectId.trim(),
      commitSha: input.commitSha.trim(),
      branchName: input.branchName?.trim() || null
    });
    return NextResponse.json({ commitReview: result.run, job: result.job }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
