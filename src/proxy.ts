import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { canonicalRedirectUrl } from "./lib/canonical-origin";

export function proxy(request: NextRequest) {
  const redirectUrl = canonicalRedirectUrl({
    requestUrl: request.url,
    method: request.method,
    publicBaseUrl: process.env.PUBLIC_BASE_URL,
    accept: request.headers.get("accept"),
    host: request.headers.get("host"),
    forwardedHost: request.headers.get("x-forwarded-host"),
    forwardedProto: request.headers.get("x-forwarded-proto")
  });

  if (redirectUrl) {
    const rewriteUrl = new URL("/api/canonical-redirect", request.url);
    rewriteUrl.searchParams.set("to", redirectUrl);
    return NextResponse.rewrite(rewriteUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"]
};
