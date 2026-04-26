export const USER_ROLES = ["admin", "user"] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function normalizeRole(role: string | null | undefined): UserRole {
  return role === "admin" ? "admin" : "user";
}
