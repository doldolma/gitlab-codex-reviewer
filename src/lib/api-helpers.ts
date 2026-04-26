import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

export function jsonError(error: unknown, status = statusForError(error)): NextResponse {
  const message = messageForError(error);
  if (status >= 500) {
    console.error("[api-error]", message, error);
  }
  return NextResponse.json({ error: message }, { status });
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return {};
  return JSON.parse(text) as unknown;
}

export function safeRedirectPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

function statusForError(error: unknown): number {
  if (error instanceof ZodError) return 400;
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return 409;
  if (error instanceof SyntaxError) return 400;
  return 500;
}

function messageForError(error: unknown): string {
  if (error instanceof ZodError) return error.issues.map((issue) => issue.message).join(", ");
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return "Duplicate record";
  }
  return error instanceof Error ? error.message : String(error);
}
