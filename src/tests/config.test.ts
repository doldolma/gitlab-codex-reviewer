import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig, resolveAppRoot, resolveCodexBin, resolveCodexHome } from "../lib/config";

describe("config codex defaults", () => {
  const originalCodexHome = process.env.CODEX_HOME;
  const originalCodexBin = process.env.CODEX_BIN;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalPollInterval = process.env.POLL_INTERVAL_SECONDS;
  const originalAppRoot = process.env.APP_ROOT;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
  const originalWorkspaceRoot = process.env.WORKSPACE_ROOT;
  const originalMaxDiffBytes = process.env.MAX_DIFF_BYTES;
  const originalMaxContextBytes = process.env.MAX_CONTEXT_BYTES;

  afterEach(() => {
    restoreEnv("CODEX_HOME", originalCodexHome);
    restoreEnv("CODEX_BIN", originalCodexBin);
    restoreEnv("DATABASE_URL", originalDatabaseUrl);
    restoreEnv("POLL_INTERVAL_SECONDS", originalPollInterval);
    restoreEnv("APP_ROOT", originalAppRoot);
    restoreEnv("NODE_ENV", originalNodeEnv);
    restoreEnv("PUBLIC_BASE_URL", originalPublicBaseUrl);
    restoreEnv("WORKSPACE_ROOT", originalWorkspaceRoot);
    restoreEnv("MAX_DIFF_BYTES", originalMaxDiffBytes);
    restoreEnv("MAX_CONTEXT_BYTES", originalMaxContextBytes);
  });

  it("uses the app root .data/codex directory without CODEX_HOME env support", () => {
    process.env.CODEX_HOME = "/tmp/ignored-codex-home";

    expect(resolveCodexHome("/opt/gitlab-codex-reviewer")).toBe("/opt/gitlab-codex-reviewer/.data/codex");
    expect(loadConfig().codexHome).toBe(resolve(process.cwd(), ".data", "codex"));
  });

  it("prefers the local node_modules codex binary", () => {
    const root = mkdtempSync(join(tmpdir(), "gitlab-codex-config-"));
    const binDir = join(root, "node_modules", ".bin");
    const binName = process.platform === "win32" ? "codex.cmd" : "codex";
    mkdirSync(binDir, { recursive: true });
    writeFileSync(join(binDir, binName), "");

    expect(resolveCodexBin(root)).toBe(join(binDir, binName));

    rmSync(root, { recursive: true, force: true });
  });

  it("falls back to the PATH codex command", () => {
    const root = mkdtempSync(join(tmpdir(), "gitlab-codex-config-"));

    expect(resolveCodexBin(root)).toBe("codex");

    rmSync(root, { recursive: true, force: true });
  });

  it("uses the internal SQLite database URL instead of DATABASE_URL env", () => {
    process.env.DATABASE_URL = "file:/tmp/ignored.sqlite";

    expect(loadConfig().databaseUrl).toBe(`file:${resolve(process.cwd(), ".data", "gitlab-codex-reviewer.sqlite")}`);
  });

  it("uses the internal five-minute polling interval instead of env", () => {
    process.env.POLL_INTERVAL_SECONDS = "10";

    expect(loadConfig().pollIntervalSeconds).toBe(300);
  });

  it("uses the internal workspace root instead of WORKSPACE_ROOT env", () => {
    process.env.WORKSPACE_ROOT = "/tmp/ignored-workspace-root";

    expect(loadConfig().workspaceRoot).toBe(resolve(process.cwd(), ".data", "workspaces"));
  });

  it("uses internal review size limits instead of env", () => {
    process.env.MAX_DIFF_BYTES = "123";
    process.env.MAX_CONTEXT_BYTES = "456";

    const config = loadConfig();

    expect(config.maxDiffBytes).toBe(200_000);
    expect(config.maxContextBytes).toBe(120_000);
  });

  it("uses APP_ROOT for runtime data paths in standalone deployments", () => {
    const root = mkdtempSync(join(tmpdir(), "gitlab-codex-app-root-"));
    process.env.APP_ROOT = root;

    const config = loadConfig();

    expect(resolveAppRoot()).toBe(root);
    expect(config.databaseUrl).toBe(`file:${resolve(root, ".data", "gitlab-codex-reviewer.sqlite")}`);
    expect(config.codexHome).toBe(resolve(root, ".data", "codex"));
    expect(config.workspaceRoot).toBe(resolve(root, ".data", "workspaces"));

    rmSync(root, { recursive: true, force: true });
  });

  it("bases secure cookie behavior on PUBLIC_BASE_URL instead of NODE_ENV", () => {
    setEnv("NODE_ENV", "production");
    setEnv("PUBLIC_BASE_URL", "http://127.0.0.1:3000");

    expect(loadConfig().secureCookies).toBe(false);

    setEnv("PUBLIC_BASE_URL", "https://reviewer.example.com");
    expect(loadConfig().secureCookies).toBe(true);
  });
});

function setEnv(key: "NODE_ENV" | "PUBLIC_BASE_URL", value: string): void {
  (process.env as Record<string, string | undefined>)[key] = value;
}

function restoreEnv(
  key:
    | "CODEX_HOME"
    | "CODEX_BIN"
    | "DATABASE_URL"
    | "POLL_INTERVAL_SECONDS"
    | "APP_ROOT"
    | "NODE_ENV"
    | "PUBLIC_BASE_URL"
    | "WORKSPACE_ROOT"
    | "MAX_DIFF_BYTES"
    | "MAX_CONTEXT_BYTES",
  value: string | undefined
): void {
  const env = process.env as Record<string, string | undefined>;
  if (value === undefined) {
    delete env[key];
    return;
  }
  env[key] = value;
}
