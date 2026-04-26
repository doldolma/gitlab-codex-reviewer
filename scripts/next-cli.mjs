import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

const envFile = findEnvFile();
loadDotenv({ path: envFile });

const mode = process.argv[2];
if (!["dev", "start"].includes(mode)) {
  console.error("Usage: node scripts/next-cli.mjs <dev|start>");
  process.exit(1);
}

const host = process.env.HOST || "127.0.0.1";
const port = process.env.PORT || "3000";
const bin = resolve("node_modules/.bin/next");
const executable = process.platform === "win32" ? `${bin}.cmd` : bin;

const result = spawnSync(executable, [mode, "--hostname", host, "--port", port], {
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
