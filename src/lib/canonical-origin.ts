const STATIC_FILE_PATTERN = /\/[^/]+\.[^/]+$/;

export type CanonicalRedirectInput = {
  requestUrl: string;
  method: string;
  publicBaseUrl?: string;
  accept?: string | null;
  host?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
};

export function canonicalRedirectUrl(input: CanonicalRedirectInput): string | null {
  if (!["GET", "HEAD"].includes(input.method.toUpperCase())) return null;
  if (!input.publicBaseUrl) return null;

  let canonicalOrigin: string;
  let requestUrl: URL;
  try {
    canonicalOrigin = new URL(input.publicBaseUrl).origin;
    requestUrl = new URL(input.requestUrl);
  } catch {
    return null;
  }

  const requestOrigin = requestOriginFromHeaders(input, requestUrl);
  if (requestOrigin === canonicalOrigin) return null;
  if (!shouldCanonicalizePath(requestUrl.pathname, input.accept)) return null;

  const target = new URL(requestUrl.pathname, canonicalOrigin);
  target.search = requestUrl.search;
  return target.toString();
}

function requestOriginFromHeaders(input: CanonicalRedirectInput, requestUrl: URL): string {
  const host = firstHeaderValue(input.forwardedHost) ?? firstHeaderValue(input.host);
  if (!host) return requestUrl.origin;

  const proto = firstHeaderValue(input.forwardedProto) ?? requestUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

function firstHeaderValue(value?: string | null): string | null {
  const first = value?.split(",")[0]?.trim();
  return first || null;
}

function shouldCanonicalizePath(pathname: string, accept?: string | null): boolean {
  if (pathname === "/api/auth/gitlab/start") return true;
  if (pathname.startsWith("/api/")) return false;
  if (pathname.startsWith("/_next/")) return false;
  if (STATIC_FILE_PATTERN.test(pathname)) return false;

  if (accept && !accept.includes("text/html") && !accept.includes("*/*")) {
    return false;
  }
  return true;
}
