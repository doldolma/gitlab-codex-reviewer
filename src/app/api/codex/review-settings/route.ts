import { NextResponse } from "next/server";
import { z } from "zod";
import {
  CODEX_REVIEW_REASONING_EFFORTS,
  CodexReviewSettingsError,
  CodexReviewSettingsPermissionError
} from "../../../../lib/codex-review-settings";
import { jsonError, readJson } from "../../../../lib/api-helpers";
import { isAuthFailure, requireAdminUser, requireSessionUser } from "../../../../lib/session";
import { codexReviewSettings } from "../../../../lib/services";

export const runtime = "nodejs";

const settingsInput = z.object({
  model: z.string(),
  reasoningEffort: z.enum(CODEX_REVIEW_REASONING_EFFORTS)
});

export async function GET() {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;
  return NextResponse.json(await codexReviewSettings.getEffectiveReviewSettings());
}

export async function PATCH(request: Request) {
  const user = await requireAdminUser();
  if (isAuthFailure(user)) return user;

  try {
    const input = settingsInput.parse(await readJson(request));
    return NextResponse.json(await codexReviewSettings.updateReviewSettings(user, input));
  } catch (error) {
    if (error instanceof CodexReviewSettingsPermissionError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof CodexReviewSettingsError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return jsonError(error);
  }
}
