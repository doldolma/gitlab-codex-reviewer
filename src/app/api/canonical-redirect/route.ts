import { NextRequest } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("to");
  const publicBaseUrl = process.env.PUBLIC_BASE_URL || "http://127.0.0.1:3000";

  try {
    if (!target) throw new Error("Missing redirect target");

    const canonicalOrigin = new URL(publicBaseUrl).origin;
    const targetUrl = new URL(target);
    if (targetUrl.origin !== canonicalOrigin) throw new Error("Invalid redirect target");

    return new Response(null, {
      status: 307,
      headers: {
        "cache-control": "no-store",
        location: targetUrl.toString()
      }
    });
  } catch {
    return new Response("Bad Request", {
      status: 400,
      headers: {
        "cache-control": "no-store"
      }
    });
  }
}
