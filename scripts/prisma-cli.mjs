import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

const envFile = findEnvFile();
loadDotenv({ path: envFile });

const DEFAULT_DATABASE_URL = "file:../.data/gitlab-codex-reviewer.sqlite";
process.env.DATABASE_URL = DEFAULT_DATABASE_URL;

mkdirSync(resolve(dirname(resolve(envFile)), ".data"), { recursive: true });
ensureSqliteFile(process.env.DATABASE_URL);

const bin = resolve("node_modules/.bin/prisma");
const executable = process.platform === "win32" ? `${bin}.cmd` : bin;
const result = spawnSync(executable, process.argv.slice(2), {
  stdio: "inherit",
  env: process.env
});

process.exit(result.status ?? 1);

function findEnvFile() {
  let current = process.cwd();
  const root = parse(current).root;

  for (;;) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) return candidate;
    if (current === root) return ".env";
    current = dirname(current);
  }
}

function ensureSqliteFile(databaseUrl) {
  if (!databaseUrl?.startsWith("file:")) return;

  const pathPart = databaseUrl.slice("file:".length);
  if (!pathPart || pathPart === ":memory:") return;

  const databasePath = pathPart.startsWith("/")
    ? pathPart
    : resolve(process.cwd(), "prisma", pathPart);
  mkdirSync(dirname(databasePath), { recursive: true });
  if (!existsSync(databasePath)) writeFileSync(databasePath, "");
}
