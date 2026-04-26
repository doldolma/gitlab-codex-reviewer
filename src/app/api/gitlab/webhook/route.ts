import { NextResponse } from "next/server";
import { gitlabWebhooks } from "../../../../lib/services";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
  }

  const result = await gitlabWebhooks.handleWebhook(
    request.headers.get("x-gitlab-event"),
    request.headers.get("x-gitlab-token"),
    payload
  );

  if (!result.accepted) {
    const reason = result.reason?.toLowerCase() ?? "";
    const status = reason.includes("token") || reason.includes("registered") ? 401 : 400;
    return NextResponse.json({ error: result.reason ?? "Webhook rejected" }, { status });
  }

  return NextResponse.json(result, { status: 202 });
}
