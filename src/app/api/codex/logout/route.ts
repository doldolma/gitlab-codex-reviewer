import { NextResponse } from "next/server";
import { isAuthFailure, requireAdminUser } from "../../../../lib/session";
import { codexAuth } from "../../../../lib/services";

export const runtime = "nodejs";

export async function POST() {
  const user = await requireAdminUser();
  if (isAuthFailure(user)) return user;
  await codexAuth.logout();
  return NextResponse.json({ ok: true });
}
