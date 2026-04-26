import { NextResponse } from "next/server";
import { isAuthFailure, requireAdminUser } from "../../../../../lib/session";
import { codexAuth } from "../../../../../lib/services";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const user = await requireAdminUser();
  if (isAuthFailure(user)) return user;

  const body = await request.json().catch(() => null);
  const mode = typeof body === "object" && body && "mode" in body && body.mode === "browser" ? "browser" : "device";

  if (mode === "browser") {
    return NextResponse.json(await codexAuth.startBrowserLogin());
  }

  return NextResponse.json(await codexAuth.startDeviceLogin());
}
