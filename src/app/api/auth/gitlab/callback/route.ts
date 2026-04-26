import { NextRequest, NextResponse } from "next/server";
import { safeRedirectPath } from "../../../../../lib/api-helpers";
import { createSessionRecord, setSessionCookie } from "../../../../../lib/session";
import { config, gitlabOAuth } from "../../../../../lib/services";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get("code");
    const state = request.nextUrl.searchParams.get("state");
    if (!code || !state) throw new Error("Missing GitLab OAuth code or state");

    const { user, token, redirectTo } = await gitlabOAuth.completeCallback(code, state);
    const appUser = await gitlabOAuth.upsertUser(user);
    await gitlabOAuth.saveAuthenticatedConnection(appUser.id, user, token);
    const session = await createSessionRecord(appUser);
    const response = NextResponse.redirect(new URL(safeRedirectPath(redirectTo), config.publicBaseUrl));
    setSessionCookie(response, session);
    return response;
  } catch (error) {
    const message = encodeURIComponent(error instanceof Error ? error.message : String(error));
    return NextResponse.redirect(new URL(`/login?error=${message}`, config.publicBaseUrl));
  }
}
