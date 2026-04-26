import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUser } from "../../../../lib/session";
import { reviewerBot } from "../../../../lib/services";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;
  return NextResponse.json(await reviewerBot.status());
}
