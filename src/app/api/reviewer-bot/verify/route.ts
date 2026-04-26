import { NextResponse } from "next/server";
import { jsonError } from "../../../../lib/api-helpers";
import { isAuthFailure, requireAdminUser } from "../../../../lib/session";
import { reviewerBot } from "../../../../lib/services";

export const runtime = "nodejs";

export async function POST() {
  const user = await requireAdminUser();
  if (isAuthFailure(user)) return user;

  try {
    return NextResponse.json(await reviewerBot.verify());
  } catch (error) {
    return jsonError(error);
  }
}
