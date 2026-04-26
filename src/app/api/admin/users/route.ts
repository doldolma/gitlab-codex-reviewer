import { NextResponse } from "next/server";
import { isAuthFailure, requireAdminUser } from "../../../../lib/session";
import { userAdmin } from "../../../../lib/services";

export const runtime = "nodejs";

export async function GET() {
  const user = await requireAdminUser();
  if (isAuthFailure(user)) return user;
  return NextResponse.json({ users: await userAdmin.listUsers() });
}
