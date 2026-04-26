import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, readJson } from "../../../../../../lib/api-helpers";
import { isAuthFailure, requireAdminUser } from "../../../../../../lib/session";
import { userAdmin } from "../../../../../../lib/services";
import { LastAdminError, UserAdminNotFoundError } from "../../../../../../lib/user-admin";

export const runtime = "nodejs";

const roleInput = z.object({
  role: z.enum(["admin", "user"])
});

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const user = await requireAdminUser();
  if (isAuthFailure(user)) return user;

  try {
    const { id } = await context.params;
    const input = roleInput.parse(await readJson(request));
    return NextResponse.json({ user: await userAdmin.updateRole(Number(id), input.role) });
  } catch (error) {
    if (error instanceof UserAdminNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof LastAdminError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return jsonError(error);
  }
}
