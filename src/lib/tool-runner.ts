import { access, stat } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { PromptToolFinding } from "./prompts";

export type ToolRunnerEvent =
  | {
      tool: string;
      status: "skipped" | "passed" | "findings" | "failed";
      summary: string;
      findings: PromptToolFinding[];
      durationMs: number;
      outputBytes: number;
      outputPreview: string | null;
      outputTruncated: boolean;
    };

export type ToolRunnerInput = {
  workingDirectory: string;
  changedFiles: string[];
  timeoutMs?: number;
};

const DEFAULT_TIMEOUT_MS = 15_000;
const OUTPUT_PREVIEW_CHARS = 4000;
const MAX_FINDINGS = 30;

export class ReadonlyToolRunner {
  async run(input: ToolRunnerInput): Promise<ToolRunnerEvent[]> {
    const events: ToolRunnerEvent[] = [];
    events.push(await this.runRgRiskScan(input));
    events.push(await this.runGitleaks(input));
    events.push(await this.runGolangciLint(input));
    events.push(await this.runEslint(input));
    return events;
  }

  private async runRgRiskScan(input: ToolRunnerInput): Promise<ToolRunnerEvent> {
    const startedAt = Date.now();
    const rg = await executableExists("rg");
    if (!rg) return skipped("rg-risk-scan", "rg가 설치되어 있지 않아 범용 위험 패턴 탐지를 건너뜁니다.", startedAt);

    const pattern = [
      "TODO.*(security|auth|permission|권한|보안)",
      "FIXME.*(security|auth|permission|권한|보안)",
      "password\\s*[:=]",
      "api[_-]?key\\s*[:=]",
      "secret\\s*[:=]",
      "SELECT \\*",
      "catch\\s*\\([^)]*\\)\\s*\\{\\s*\\}"
    ].join("|");
    const result = await runCommand("rg", ["-n", "-i", "--hidden", "--glob", "!node_modules/**", "--glob", "!.git/**", pattern, "."], input);
    const findings = parseRgFindings(result.stdout);
    if (result.timedOut) return failed("rg-risk-scan", "범용 위험 패턴 탐지가 시간 초과되었습니다.", startedAt, result);
    if (result.code > 1) return failed("rg-risk-scan", "범용 위험 패턴 탐지 명령이 실패했습니다.", startedAt, result);
    return {
      tool: "rg-risk-scan",
      status: findings.length ? "findings" : "passed",
      summary: findings.length ? `${findings.length}개의 위험 패턴 후보를 찾았습니다.` : "범용 위험 패턴 후보가 없습니다.",
      findings,
      durationMs: Date.now() - startedAt,
      outputBytes: Buffer.byteLength(result.stdout + result.stderr, "utf8"),
      ...preview(result.stdout || result.stderr)
    };
  }

  private async runGitleaks(input: ToolRunnerInput): Promise<ToolRunnerEvent> {
    const startedAt = Date.now();
    if (!(await executableExists("gitleaks"))) return skipped("gitleaks", "gitleaks가 설치되어 있지 않아 secret scan을 건너뜁니다.", startedAt);
    const result = await runCommand("gitleaks", ["dir", "--redact", "--report-format", "json", "."], input);
    const findings = parseGitleaksFindings(result.stdout);
    if (result.timedOut) return failed("gitleaks", "gitleaks 실행이 시간 초과되었습니다.", startedAt, result);
    if (result.code > 1) return failed("gitleaks", "gitleaks 실행이 실패했습니다.", startedAt, result);
    return {
      tool: "gitleaks",
      status: findings.length ? "findings" : "passed",
      summary: findings.length ? `${findings.length}개의 secret 후보를 찾았습니다.` : "secret 후보가 없습니다.",
      findings,
      durationMs: Date.now() - startedAt,
      outputBytes: Buffer.byteLength(result.stdout + result.stderr, "utf8"),
      ...preview(result.stdout || result.stderr)
    };
  }

  private async runGolangciLint(input: ToolRunnerInput): Promise<ToolRunnerEvent> {
    const startedAt = Date.now();
    if (!(await executableExists("golangci-lint"))) return skipped("golangci-lint", "golangci-lint가 설치되어 있지 않아 Go lint를 건너뜁니다.", startedAt);
    if (!(await anyExists(input.workingDirectory, [".golangci.yml", ".golangci.yaml", ".golangci.toml", ".golangci.json"]))) {
      return skipped("golangci-lint", "golangci-lint 설정 파일이 없어 Go lint를 건너뜁니다.", startedAt);
    }
    const result = await runCommand("golangci-lint", ["run", "--out-format", "json"], input);
    const findings = parseGolangciFindings(result.stdout);
    if (result.timedOut) return failed("golangci-lint", "golangci-lint 실행이 시간 초과되었습니다.", startedAt, result);
    if (result.code > 1) return failed("golangci-lint", "golangci-lint 실행이 실패했습니다.", startedAt, result);
    return {
      tool: "golangci-lint",
      status: findings.length ? "findings" : "passed",
      summary: findings.length ? `${findings.length}개의 Go lint 후보를 찾았습니다.` : "Go lint 후보가 없습니다.",
      findings,
      durationMs: Date.now() - startedAt,
      outputBytes: Buffer.byteLength(result.stdout + result.stderr, "utf8"),
      ...preview(result.stdout || result.stderr)
    };
  }

  private async runEslint(input: ToolRunnerInput): Promise<ToolRunnerEvent> {
    const startedAt = Date.now();
    const eslintBin = await resolveEslintCommand(input.workingDirectory);
    if (!eslintBin) return skipped("eslint", "eslint 바이너리가 없어 JS/TS lint를 건너뜁니다.", startedAt);
    if (!(await anyExists(input.workingDirectory, ["eslint.config.js", "eslint.config.mjs", ".eslintrc", ".eslintrc.js", ".eslintrc.json"]))) {
      return skipped("eslint", "eslint 설정 파일이 없어 JS/TS lint를 건너뜁니다.", startedAt);
    }
    const result = await runCommand(eslintBin, ["--format", "json", "."], input);
    const findings = parseEslintFindings(result.stdout);
    if (result.timedOut) return failed("eslint", "eslint 실행이 시간 초과되었습니다.", startedAt, result);
    if (result.code > 1 && isEslintDependencyFailure(result.stdout + "\n" + result.stderr)) {
      return skippedWithOutput("eslint", "ESLint 설정의 plugin/parser 의존성을 컨테이너에서 찾을 수 없어 JS/TS lint를 건너뜁니다.", startedAt, result);
    }
    if (result.code > 1) return failed("eslint", "eslint 실행이 실패했습니다.", startedAt, result);
    return {
      tool: "eslint",
      status: findings.length ? "findings" : "passed",
      summary: findings.length ? `${findings.length}개의 JS/TS lint 후보를 찾았습니다.` : "JS/TS lint 후보가 없습니다.",
      findings,
      durationMs: Date.now() - startedAt,
      outputBytes: Buffer.byteLength(result.stdout + result.stderr, "utf8"),
      ...preview(result.stdout || result.stderr)
    };
  }
}

async function runCommand(command: string, args: string[], input: ToolRunnerInput): Promise<{ code: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: input.workingDirectory,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > OUTPUT_PREVIEW_CHARS * 4) stdout = stdout.slice(0, OUTPUT_PREVIEW_CHARS * 4);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
      if (stderr.length > OUTPUT_PREVIEW_CHARS * 4) stderr = stderr.slice(0, OUTPUT_PREVIEW_CHARS * 4);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: stderr || error.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout: redactSensitive(stdout), stderr: redactSensitive(stderr), timedOut });
    });
  });
}

function parseRgFindings(output: string): PromptToolFinding[] {
  return output.split(/\r?\n/).filter(Boolean).slice(0, MAX_FINDINGS).map((line) => {
    const match = /^(.+?):(\d+):(.*)$/.exec(line);
    return {
      tool: "rg-risk-scan",
      severity: "medium",
      title: "위험 패턴 후보",
      file: match?.[1] ?? null,
      line: match?.[2] ? Number(match[2]) : null,
      summary: (match?.[3] ?? line).trim().slice(0, 300)
    };
  });
}

function parseGitleaksFindings(output: string): PromptToolFinding[] {
  const parsed = safeJson(output);
  if (!Array.isArray(parsed)) return [];
  return parsed.slice(0, MAX_FINDINGS).map((item) => ({
    tool: "gitleaks",
    severity: "high",
    title: stringField(item, "RuleID") || "Secret 후보",
    file: stringField(item, "File") || null,
    line: numberField(item, "StartLine"),
    summary: stringField(item, "Description") || "secret 후보가 감지되었습니다."
  }));
}

function parseGolangciFindings(output: string): PromptToolFinding[] {
  const parsed = safeJson(output);
  const issues = isRecord(parsed) && Array.isArray(parsed.Issues) ? parsed.Issues : [];
  return issues.slice(0, MAX_FINDINGS).map((item) => {
    const position = isRecord(item) && isRecord(item.Pos) ? item.Pos : {};
    return {
      tool: "golangci-lint",
      severity: "medium",
      title: stringField(item, "FromLinter") || "Go lint 후보",
      file: stringField(position, "Filename") || null,
      line: numberField(position, "Line"),
      summary: stringField(item, "Text") || "Go lint 후보가 감지되었습니다."
    };
  });
}

function parseEslintFindings(output: string): PromptToolFinding[] {
  const parsed = safeJson(output);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((file) => {
    const messages = isRecord(file) && Array.isArray(file.messages) ? file.messages : [];
    return messages.map((message) => ({
      tool: "eslint",
      severity: numberField(message, "severity") === 2 ? "medium" as const : "low" as const,
      title: stringField(message, "ruleId") || "ESLint 후보",
      file: stringField(file, "filePath") || null,
      line: numberField(message, "line"),
      summary: stringField(message, "message") || "ESLint 후보가 감지되었습니다."
    }));
  }).slice(0, MAX_FINDINGS);
}

function skipped(tool: string, summary: string, startedAt: number): ToolRunnerEvent {
  return { tool, status: "skipped", summary, findings: [], durationMs: Date.now() - startedAt, outputBytes: 0, outputPreview: null, outputTruncated: false };
}

function skippedWithOutput(tool: string, summary: string, startedAt: number, result: { stdout: string; stderr: string }): ToolRunnerEvent {
  const output = result.stderr || result.stdout;
  return { tool, status: "skipped", summary, findings: [], durationMs: Date.now() - startedAt, outputBytes: Buffer.byteLength(output, "utf8"), ...preview(output) };
}

function failed(tool: string, summary: string, startedAt: number, result: { stdout: string; stderr: string }): ToolRunnerEvent {
  const output = result.stderr || result.stdout;
  return { tool, status: "failed", summary, findings: [], durationMs: Date.now() - startedAt, outputBytes: Buffer.byteLength(output, "utf8"), ...preview(output) };
}

function preview(output: string): { outputPreview: string | null; outputTruncated: boolean } {
  const redacted = redactSensitive(output.trim());
  if (!redacted) return { outputPreview: null, outputTruncated: false };
  return {
    outputPreview: redacted.slice(0, OUTPUT_PREVIEW_CHARS),
    outputTruncated: redacted.length > OUTPUT_PREVIEW_CHARS
  };
}

async function executableExists(command: string): Promise<boolean> {
  const result = await runCommand("which", [command], { workingDirectory: process.cwd(), changedFiles: [], timeoutMs: 3000 });
  return result.code === 0;
}

async function resolveEslintCommand(workingDirectory: string): Promise<string | null> {
  const binName = process.platform === "win32" ? "eslint.cmd" : "eslint";
  const workspaceBin = join(workingDirectory, "node_modules", ".bin", binName);
  if (await fileExists(workspaceBin)) return workspaceBin;

  const appBin = join(process.env.APP_ROOT || process.cwd(), "node_modules", ".bin", binName);
  if (await fileExists(appBin)) return appBin;

  if (await executableExists("eslint")) return "eslint";
  return null;
}

function isEslintDependencyFailure(output: string): boolean {
  return /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|Failed to load (plugin|parser|config)|couldn't find the (plugin|parser)|ESLint couldn't find the (plugin|config)/i.test(output);
}

async function anyExists(root: string, paths: string[]): Promise<boolean> {
  for (const path of paths) {
    if (await fileExists(join(root, path))) return true;
  }
  return false;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    const value = await stat(path);
    return value.isFile() || value.isSymbolicLink();
  } catch {
    return false;
  }
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "string" ? field : null;
}

function numberField(value: unknown, key: string): number | null {
  if (!isRecord(value)) return null;
  const field = value[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

export function redactSensitive(value: string): string {
  return value
    .replace(/(Authorization:\s*)(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, "$1<redacted>")
    .replace(/(PRIVATE-TOKEN[=:\s]+)[A-Za-z0-9._-]+/gi, "$1<redacted>")
    .replace(/(token|password|secret|api[_-]?key)([\"'\s:=]+)[A-Za-z0-9+/=._-]{12,}/gi, "$1$2<redacted>");
}
