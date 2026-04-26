import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { loadConfig } from "./config";
import { nowIso, prisma } from "./prisma";
import { normalizeRole, type UserRole } from "./roles";

export type SessionUser = {
  id: number;
  gitlabHost: string;
  gitlabUserId: number;
  username: string;
  role: UserRole;
};

const COOKIE_NAME = "glcr_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;

export type CreatedSession = {
  id: string;
  expiresAt: string;
};

export async function createSessionRecord(user: SessionUser): Promise<CreatedSession> {
  const id = randomBytes(32).toString("base64url");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await prisma.session.create({
    data: {
      id,
      userId: user.id,
      expiresAt,
      createdAt
    }
  });

  return { id, expiresAt };
}

export function setSessionCookie(response: NextResponse, session: CreatedSession): void {
  const config = loadConfig();
  response.cookies.set(COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
    expires: new Date(session.expiresAt)
  });
}

export async function createSession(user: SessionUser): Promise<string> {
  const session = await createSessionRecord(user);
  const cookieStore = await cookies();
  const config = loadConfig();
  cookieStore.set(COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.secureCookies,
    path: "/",
    expires: new Date(session.expiresAt)
  });
  return session.id;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const row = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: true }
  });

  if (!row || Date.parse(row.expiresAt) < Date.now()) {
    await destroySessionById(sessionId);
    return null;
  }

  return {
    id: row.user.id,
    gitlabHost: row.user.gitlabHost,
    gitlabUserId: row.user.gitlabUserId,
    username: row.user.username,
    role: normalizeRole(row.user.role)
  };
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAME)?.value;
  if (sessionId) await destroySessionById(sessionId);
  cookieStore.delete(COOKIE_NAME);
}

export async function destroyCurrentSessionRecord(): Promise<void> {
  const cookieStore = await cookies();
  const sessionId = cookieStore.get(COOKIE_NAME)?.value;
  if (sessionId) await destroySessionById(sessionId);
}

export function clearSessionCookie(response: NextResponse): void {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: loadConfig().secureCookies,
    path: "/",
    expires: new Date(0),
    maxAge: 0
  });
}

export async function requireSessionUser(): Promise<SessionUser | NextResponse> {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  return user;
}

export async function requireAdminUser(): Promise<SessionUser | NextResponse> {
  const user = await requireSessionUser();
  if (isAuthFailure(user)) return user;
  if (user.role !== "admin") return NextResponse.json({ error: "Admin role required" }, { status: 403 });
  return user;
}

async function destroySessionById(id: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id } });
}

export function isAuthFailure(value: SessionUser | NextResponse): value is NextResponse {
  return value instanceof Response;
}

export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
