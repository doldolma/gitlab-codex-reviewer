import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUser } from "../../../lib/session";
import { gitlabOAuth, reviewState } from "../../../lib/services";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;
  return NextResponse.json({
    stats: await reviewState.dashboardStats(user.id),
    gitlab: await gitlabOAuth.getConnectionSummary(user.id),
    currentUser: {
      userId: user.id,
      gitlabHost: user.gitlabHost,
      gitlabUserId: user.gitlabUserId,
      username: user.username,
      role: user.role
    },
    recentMergeRequests: (await reviewState.listMergeRequestViews(user.id)).slice(0, 8)
  });
}
