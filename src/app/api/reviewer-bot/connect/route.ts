import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../../lib/api-helpers";
import { isAuthFailure, requireAdminUser } from "../../../../lib/session";
import { reviewerBot } from "../../../../lib/services";

export const runtime = "nodejs";

const inputSchema = z.object({
  token: z.string().min(1)
});

export async function POST(request: Request) {
  const user = await requireAdminUser();
  if (isAuthFailure(user)) return user;

  try {
    const input = inputSchema.parse(await readJson(request));
    return NextResponse.json(await reviewerBot.saveToken(input.token));
  } catch (error) {
    return jsonError(error);
  }
}
