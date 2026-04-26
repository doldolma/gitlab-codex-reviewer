import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";
import type { AppConfig } from "./config";
import type { GitLabDiff } from "./gitlab-client";
import type { GitlabProjectRow } from "./review-state";

export type WorkspaceCheckout = {
  path: string;
  sha: string;
};

export class GitWorkspaceManager {
  constructor(private readonly config: AppConfig) {}

  async checkout(project: GitlabProjectRow, token: string, sha: string): Promise<WorkspaceCheckout> {
    if (!project.cloneHttpUrl) throw new Error("GitLab project clone URL is not available");
    const workspacePath = this.workspacePath(project);
    await fs.mkdir(this.config.workspaceRoot, { recursive: true });

    if (!existsSync(join(workspacePath, ".git"))) {
      await git(["clone", "--no-checkout", project.cloneHttpUrl, workspacePath], undefined, token);
    }

    await git(["remote", "set-url", "origin", project.cloneHttpUrl], workspacePath);
    await git(["fetch", "--prune", "origin"], workspacePath, token);
    await git(["checkout", "--detach", sha], workspacePath);
    return { path: workspacePath, sha };
  }

  workspacePath(project: GitlabProjectRow): string {
    const key = `${project.gitlabHost}:${project.gitlabProjectId}`;
    return resolve(this.config.workspaceRoot, createHash("sha256").update(key).digest("hex").slice(0, 24));
  }
}

export async function collectWorkspaceContext(
  workspacePath: string,
  diffs: GitLabDiff[],
  maxBytes: number
): Promise<string | null> {
  const paths = uniquePaths(diffs);
  let output = "";
  let omitted = 0;

  for (const relativePath of paths) {
    const safePath = safeJoin(workspacePath, relativePath);
    if (!safePath) {
      omitted += 1;
      continue;
    }

    let content: string;
    try {
      const stat = await fs.stat(safePath);
      if (!stat.isFile()) continue;
      content = await fs.readFile(safePath, "utf8");
    } catch {
      omitted += 1;
      continue;
    }

    const chunk = [`# File: ${relativePath}`, "```", trimToBytes(content, Math.min(30_000, maxBytes)), "```", ""].join("\n");
    if (Buffer.byteLength(output + chunk, "utf8") > maxBytes) {
      omitted += 1;
      continue;
    }
    output += chunk;
  }

  if (!output && omitted === 0) return null;
  if (omitted > 0) output += `\n# Workspace context truncated or unavailable for ${omitted} file(s).\n`;
  return output || null;
}

function git(args: string[], cwd: string | undefined, token?: string): Promise<void> {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const authArgs = token ? ["-c", `http.extraHeader=Authorization: Basic ${basicToken(token)}`] : [];
  const fullArgs = [...authArgs, ...(cwd ? ["-C", cwd] : []), ...args];

  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", fullArgs, { env, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(new Error(`git ${args[0]} failed with ${code}: ${sanitizeGitError(stderr)}`));
    });
  });
}

function basicToken(token: string): string {
  return Buffer.from(`oauth2:${token}`, "utf8").toString("base64");
}

function sanitizeGitError(value: string): string {
  return value.replace(/(Authorization:\s*)(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, "$1<redacted>").slice(0, 1200);
}

function uniquePaths(diffs: GitLabDiff[]): string[] {
  return [
    ...new Set(
      diffs
        .map((diff) => (diff.deleted_file ? diff.old_path : diff.new_path))
        .filter((path) => path && !path.includes("\0"))
    )
  ];
}

function safeJoin(root: string, relativePath: string): string | null {
  if (relativePath.startsWith("/") || relativePath.startsWith("\\")) return null;
  if (relativePath.split(/[\\/]/).includes("..")) return null;
  const normalizedRoot = resolve(root);
  const resolved = resolve(root, relativePath);
  return resolved === normalizedRoot || resolved.startsWith(`${normalizedRoot}${sep}`) ? resolved : null;
}

function trimToBytes(value: string, maxBytes: number): string {
  let current = value;
  while (Buffer.byteLength(current, "utf8") > maxBytes) {
    current = current.slice(0, Math.floor(current.length * 0.8));
  }
  return current === value ? value : `${current}\n# File content truncated.\n`;
}
