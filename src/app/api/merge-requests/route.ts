import { NextResponse } from "next/server";
import { isAuthFailure, requireSessionUser } from "../../../lib/session";
import { reviewState } from "../../../lib/services";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;
  const url = new URL(request.url);
  return NextResponse.json(await reviewState.listMergeRequestViews(user.id, {
    page: parsePositiveInt(url.searchParams.get("page"), 1),
    pageSize: Math.min(parsePositiveInt(url.searchParams.get("pageSize"), 20), 100)
  }));
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}
