import { NextResponse } from "next/server";
import { jsonError } from "../../../../lib/api-helpers";
import { isAuthFailure, requireAdminUser } from "../../../../lib/session";
import { reviewerBot } from "../../../../lib/services";

export const runtime = "nodejs";

export async function DELETE() {
  const user = await requireAdminUser();
  if (isAuthFailure(user)) return user;

  try {
    await reviewerBot.disconnect();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
