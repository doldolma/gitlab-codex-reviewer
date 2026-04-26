import { NextResponse } from "next/server";
import { getSessionUser } from "../../../../lib/session";
import { gitlabOAuth } from "../../../../lib/services";

export const runtime = "nodejs";

export async function GET() {
  const sessionUser = await getSessionUser();
  return NextResponse.json({
    authenticated: Boolean(sessionUser),
    currentUser: sessionUser
      ? {
          userId: sessionUser.id,
          gitlabHost: sessionUser.gitlabHost,
          gitlabUserId: sessionUser.gitlabUserId,
          username: sessionUser.username,
          role: sessionUser.role
        }
      : null,
    gitlab: sessionUser ? await gitlabOAuth.getConnectionSummary(sessionUser.id) : null,
    oauthConfigured: gitlabOAuth.isConfigured()
  });
}
