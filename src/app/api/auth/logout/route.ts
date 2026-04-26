import { NextResponse } from "next/server";
import { clearSessionCookie, destroyCurrentSessionRecord } from "../../../../lib/session";

export const runtime = "nodejs";

export async function POST() {
  await destroyCurrentSessionRecord();
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
}
