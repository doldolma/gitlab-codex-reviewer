import { NextRequest, NextResponse } from "next/server";
import { jsonError, safeRedirectPath } from "../../../../../lib/api-helpers";
import { gitlabOAuth } from "../../../../../lib/services";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const redirectTo = safeRedirectPath(request.nextUrl.searchParams.get("redirectTo"));
    const authUrl = await gitlabOAuth.createAuthorizationUrl(redirectTo);
    return NextResponse.redirect(authUrl);
  } catch (error) {
    return jsonError(error, 400);
  }
}
