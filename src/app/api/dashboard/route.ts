import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUser } from "../../../lib/session";
import { gitlabOAuth, reviewState } from "../../../lib/services";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;
  const [stats, qualityStats, recentMergeRequests] = await Promise.all([
    reviewState.dashboardStats(user.id),
    reviewState.reviewQualityStats(user.id),
    reviewState.listMergeRequestViews(user.id)
  ]);
  return NextResponse.json({
    stats: { ...stats, ...qualityStats },
    gitlab: await gitlabOAuth.getConnectionSummary(user.id),
    currentUser: {
      userId: user.id,
      gitlabHost: user.gitlabHost,
      gitlabUserId: user.gitlabUserId,
      username: user.username,
      role: user.role
    },
    recentMergeRequests: recentMergeRequests.slice(0, 8)
  });
}
