import { describe, expect, it } from "vitest";
import { GitLabOAuthService } from "../lib/gitlab-oauth";
import { SecretStore } from "../lib/secret-store";
import { UserAdminService } from "../lib/user-admin";
import { insertTestUser, testConfig, testDb } from "./test-utils";

describe("user roles", () => {
  it("creates the first GitLab OAuth user as admin and later users as regular users", async () => {
    const config = testConfig();
    const db = await testDb(config);
    const oauth = new GitLabOAuthService(db, config, new SecretStore(config));

    const first = await oauth.upsertUser({ id: 101, username: "alice" });
    const second = await oauth.upsertUser({ id: 102, username: "bob" });

    expect(first.role).toBe("admin");
    expect(second.role).toBe("user");
    await db.$disconnect();
  });

  it("preserves an existing user's role when they log in again", async () => {
    const config = testConfig();
    const db = await testDb(config);
    const oauth = new GitLabOAuthService(db, config, new SecretStore(config));

    const first = await oauth.upsertUser({ id: 101, username: "alice" });
    await db.user.update({ where: { id: first.id }, data: { role: "user" } });

    const again = await oauth.upsertUser({ id: 101, username: "alice-renamed" });

    expect(again.role).toBe("user");
    expect(again.username).toBe("alice-renamed");
    await db.$disconnect();
  });

  it("allows admins to change roles but keeps at least one admin", async () => {
    const db = await testDb();
    const admin = new UserAdminService(db);
    const userA = await insertTestUser(db, { gitlabUserId: 1, username: "alice", role: "admin" });
    const userB = await insertTestUser(db, { gitlabUserId: 2, username: "bob", role: "user" });

    await expect(admin.updateRole(userA, "user")).rejects.toThrow("At least one admin is required");

    await expect(admin.updateRole(userB, "admin")).resolves.toMatchObject({ role: "admin" });
    await expect(admin.updateRole(userA, "user")).resolves.toMatchObject({ role: "user" });

    const users = await admin.listUsers();
    expect(users.map((user) => [user.username, user.role])).toEqual([
      ["alice", "user"],
      ["bob", "admin"]
    ]);
    await db.$disconnect();
  });
});
