import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../../lib/api-helpers";
import { isAuthFailure, requireSessionUser } from "../../../../lib/session";
import { reviewState } from "../../../../lib/services";

export const runtime = "nodejs";

const projectUpdate = z.object({
  enabled: z.boolean().default(true),
  mrTargetBranches: z.array(z.string()).default([]),
  commitBranches: z.array(z.string()).default([])
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    const input = normalizeProjectInput(projectUpdate.parse(await readJson(request)));
    return NextResponse.json({ project: await reviewState.updateProject(user.id, Number(id), input) });
  } catch (error) {
    return jsonError(error);
  }
}

function normalizeProjectInput(input: z.infer<typeof projectUpdate>): z.infer<typeof projectUpdate> {
  return {
    ...input,
    mrTargetBranches: uniqueNonEmpty(input.mrTargetBranches),
    commitBranches: uniqueNonEmpty(input.commitBranches)
  };
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export async function DELETE(_request: Request, context: RouteContext) {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    await reviewState.deleteProject(user.id, Number(id));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
