import type { Db } from "./prisma";
import { nowIso } from "./prisma";
import { normalizeRole, type UserRole } from "./roles";

export type AdminUserView = {
  id: number;
  gitlabHost: string;
  gitlabUserId: number;
  username: string;
  name: string | null;
  webUrl: string | null;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
};

export class UserAdminService {
  constructor(private readonly db: Db) {}

  async listUsers(): Promise<AdminUserView[]> {
    const rows = await this.db.user.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    return rows.map(userViewFromRow);
  }

  async updateRole(targetUserId: number, role: UserRole): Promise<AdminUserView> {
    const target = await this.db.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new UserAdminNotFoundError();

    if (normalizeRole(target.role) === "admin" && role === "user") {
      const adminCount = await this.db.user.count({ where: { role: "admin" } });
      if (adminCount <= 1) throw new LastAdminError();
    }

    const updated = await this.db.user.update({
      where: { id: targetUserId },
      data: {
        role,
        updatedAt: nowIso()
      }
    });
    return userViewFromRow(updated);
  }
}

export class UserAdminNotFoundError extends Error {
  constructor() {
    super("User not found");
  }
}

export class LastAdminError extends Error {
  constructor() {
    super("At least one admin is required");
  }
}

type UserRow = {
  id: number;
  gitlabHost: string;
  gitlabUserId: number;
  username: string;
  name: string | null;
  webUrl: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
};

function userViewFromRow(row: UserRow): AdminUserView {
  return {
    id: row.id,
    gitlabHost: row.gitlabHost,
    gitlabUserId: row.gitlabUserId,
    username: row.username,
    name: row.name,
    webUrl: row.webUrl,
    role: normalizeRole(row.role),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}
