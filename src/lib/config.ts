import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, join, parse, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const envFilePath = findEnvFile();
loadDotenv({ path: envFilePath });

const DEFAULT_DATABASE_URL = "file:../.data/gitlab-codex-reviewer.sqlite";
const DEFAULT_REVIEW_CONCURRENCY = 3;
const DEFAULT_POLL_INTERVAL_SECONDS = 300;
export type CodexSandboxMode = "read-only" | "danger-full-access";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PUBLIC_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
  GITLAB_BASE_URL: z.string().url().default("https://gitlab.com"),
  GITLAB_OAUTH_CLIENT_ID: z.string().optional(),
  GITLAB_OAUTH_CLIENT_SECRET: z.string().optional(),
  MAX_DIFF_BYTES: z.coerce.number().int().positive().default(200_000),
  MAX_CONTEXT_BYTES: z.coerce.number().int().positive().default(120_000),
  WORKSPACE_ROOT: z.string().default(".data/workspaces")
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig() {
  const env = envSchema.parse(process.env);
  const appRoot = resolveAppRoot();
  const databaseUrl = normalizeDatabaseUrl(DEFAULT_DATABASE_URL, appRoot);
  process.env.DATABASE_URL = databaseUrl;

  const codexHome = resolveCodexHome(appRoot);
  const workspaceRoot = resolve(appRoot, env.WORKSPACE_ROOT);
  const dataDir = resolve(appRoot, ".data");
  const appSecretsPath = resolve(dataDir, "app-secrets.json");

  mkdirSync(dataDir, { recursive: true });
  mkdirSync(codexHome, { recursive: true });
  mkdirSync(workspaceRoot, { recursive: true });
  const appSecrets = loadOrCreateAppSecrets(appSecretsPath);

  const publicBaseUrl = env.PUBLIC_BASE_URL.replace(/\/$/, "");

  return {
    nodeEnv: env.NODE_ENV,
    publicBaseUrl,
    appEncryptionKey: appSecrets.encryptionKey,
    sessionSecret: appSecrets.sessionSecret,
    appSecretsPath,
    gitlab: {
      baseUrl: env.GITLAB_BASE_URL.replace(/\/$/, ""),
      clientId: env.GITLAB_OAUTH_CLIENT_ID,
      clientSecret: env.GITLAB_OAUTH_CLIENT_SECRET
    },
    databaseUrl,
    codexHome,
    codexBin: resolveCodexBin(appRoot),
    codexSandboxMode: resolveCodexSandboxMode(),
    workspaceRoot,
    pollIntervalSeconds: DEFAULT_POLL_INTERVAL_SECONDS,
    reviewConcurrency: DEFAULT_REVIEW_CONCURRENCY,
    maxDiffBytes: env.MAX_DIFF_BYTES,
    maxContextBytes: env.MAX_CONTEXT_BYTES,
    isProduction: env.NODE_ENV === "production",
    secureCookies: new URL(publicBaseUrl).protocol === "https:"
  };
}

export function resolveAppRoot(): string {
  const configured = process.env.APP_ROOT?.trim();
  return configured ? resolve(configured) : process.cwd();
}

export function resolveCodexHome(appRoot = process.cwd()): string {
  return resolve(appRoot, ".data", "codex");
}

export function resolveCodexBin(appRoot = process.cwd()): string {
  const localBin = resolve(appRoot, "node_modules", ".bin", process.platform === "win32" ? "codex.cmd" : "codex");
  if (existsSync(localBin)) return localBin;
  return "codex";
}

export function resolveCodexSandboxMode(): CodexSandboxMode {
  return isContainerRuntime() ? "danger-full-access" : "read-only";
}

function isContainerRuntime(): boolean {
  if (existsSync("/.dockerenv")) return true;
  try {
    const cgroup = readFileSync("/proc/1/cgroup", "utf8");
    return /docker|containerd|kubepods|podman/i.test(cgroup);
  } catch {
    return false;
  }
}

function normalizeDatabaseUrl(databaseUrl: string, appRoot = process.cwd()): string {
  const trimmed = databaseUrl.trim();
  if (!trimmed.startsWith("file:")) return trimmed;

  const pathPart = trimmed.slice("file:".length);
  if (pathPart.startsWith("/")) return `file:${pathPart}`;
  return `file:${resolve(prismaSchemaDir(appRoot), pathPart)}`;
}

function prismaSchemaDir(appRoot = process.cwd()): string {
  return resolve(appRoot, "prisma");
}

const appSecretsSchema = z.object({
  version: z.literal(1),
  encryptionKey: z.string().min(1),
  sessionSecret: z.string().min(1),
  createdAt: z.string()
});

type AppSecrets = z.infer<typeof appSecretsSchema>;

function loadOrCreateAppSecrets(secretsPath: string): AppSecrets {
  if (existsSync(secretsPath)) {
    return readAppSecretsWithRetry(secretsPath);
  }

  const lockPath = `${secretsPath}.lock`;
  const lockFd = acquireFileLock(lockPath);
  try {
    if (existsSync(secretsPath)) {
      return readAppSecretsWithRetry(secretsPath);
    }

    const secrets: AppSecrets = {
      version: 1,
      encryptionKey: legacyEncryptionKey() ?? randomBytes(32).toString("base64"),
      sessionSecret: process.env.SESSION_SECRET?.trim() || randomBytes(48).toString("base64"),
      createdAt: new Date().toISOString()
    };

    writeFileSync(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, { mode: 0o600 });
    try {
      chmodSync(secretsPath, 0o600);
    } catch {
      // Best-effort on filesystems that do not support POSIX permissions.
    }
    return secrets;
  } finally {
    closeSync(lockFd);
    unlinkSync(lockPath);
  }
}

function legacyEncryptionKey(): string | null {
  const configured = process.env.APP_ENCRYPTION_KEY?.trim();
  if (!configured) return null;

  const base64 = Buffer.from(configured, "base64");
  if (base64.length === 32) return base64.toString("base64");

  const hex = Buffer.from(configured, "hex");
  if (hex.length === 32) return hex.toString("base64");

  const utf8 = Buffer.from(configured, "utf8");
  if (utf8.length === 32) return utf8.toString("base64");

  throw new Error("Legacy APP_ENCRYPTION_KEY must decode to 32 bytes");
}

function validateGeneratedKey(key: string, secretsPath: string): void {
  const decoded = Buffer.from(key, "base64");
  if (decoded.length !== 32) {
    throw new Error(`Invalid encryption key in ${secretsPath}; expected a base64-encoded 32-byte key.`);
  }
}

function readAppSecretsWithRetry(secretsPath: string): AppSecrets {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const parsed = appSecretsSchema.parse(JSON.parse(readFileSync(secretsPath, "utf8")));
      validateGeneratedKey(parsed.encryptionKey, secretsPath);
      return parsed;
    } catch (error) {
      lastError = error;
      sleepMs(25);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Unable to read ${secretsPath}`);
}

function acquireFileLock(lockPath: string): number {
  mkdirSync(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      return openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (!isFileExistsError(error)) throw error;
      sleepMs(25);
    }
  }
  throw new Error(`Timed out acquiring lock ${lockPath}`);
}

function isFileExistsError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function findEnvFile(): string {
  let current = process.cwd();
  const root = parse(current).root;

  for (;;) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) return candidate;
    if (current === root) return ".env";
    current = dirname(current);
  }
}
