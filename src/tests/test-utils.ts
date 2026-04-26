import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import type { AppConfig } from "../lib/config";
import type { Db } from "../lib/prisma";
import { nowIso } from "../lib/prisma";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const databasePath = join(mkdtempSync(join(tmpdir(), "gitlab-codex-reviewer-test-")), "test.sqlite");
  return {
    nodeEnv: "test",
    publicBaseUrl: "http://127.0.0.1:3000",
    appEncryptionKey: Buffer.alloc(32, 1).toString("base64"),
    sessionSecret: "test-session-secret",
    appSecretsPath: "/tmp/gitlab-codex-reviewer-test-secrets.json",
    gitlab: {
      baseUrl: "https://gitlab.example.com",
      clientId: "client-id",
      clientSecret: "client-secret"
    },
    databaseUrl: `file:${databasePath}`,
    codexHome: "/tmp/gitlab-codex-reviewer-test-codex",
    codexBin: "codex",
    codexSandboxMode: "read-only",
    workspaceRoot: "/tmp/gitlab-codex-reviewer-test-workspaces",
    pollIntervalSeconds: 300,
    reviewConcurrency: 3,
    maxDiffBytes: 200_000,
    maxContextBytes: 120_000,
    isProduction: false,
    secureCookies: false,
    ...overrides
  };
}

export async function testDb(config = testConfig()): Promise<Db> {
  const db = new PrismaClient({
    datasources: {
      db: {
        url: config.databaseUrl
      }
    }
  });
  await executeMigrationSql(db);
  return db;
}

export async function executeMigrationSql(db: Db): Promise<void> {
  const migrationsDir = resolve("prisma/migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((entry) => entry !== "migration_lock.toml")
    .sort()
    .map((entry) => resolve(migrationsDir, entry, "migration.sql"));

  for (const file of migrationFiles) {
    await executeSqlStatements(db, readFileSync(file, "utf8"));
  }
}

export async function executeSqlStatements(db: Db, sql: string): Promise<void> {
  for (const statement of sql.split(";").map((part) => part.trim()).filter(Boolean)) {
    await db.$executeRawUnsafe(statement);
  }
}

export async function insertTestUser(
  db: Db,
  input: { gitlabHost?: string; gitlabUserId: number; username: string; role?: "admin" | "user" }
): Promise<number> {
  const timestamp = nowIso();
  const user = await db.user.create({
    data: {
      gitlabHost: input.gitlabHost ?? "https://gitlab.example.com",
      gitlabUserId: input.gitlabUserId,
      username: input.username,
      role: input.role ?? "user",
      createdAt: timestamp,
      updatedAt: timestamp
    }
  });
  return user.id;
}
