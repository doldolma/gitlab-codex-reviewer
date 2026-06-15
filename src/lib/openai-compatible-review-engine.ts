import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { Usage } from "@openai/codex-sdk";
import {
  defaultRuntimeSettings,
  type CodexReviewRuntimeSettings
} from "./codex-review-settings";
import {
  REVIEW_OUTPUT_SCHEMA,
  buildReviewPrompt,
  parseStructuredReview,
  renderReviewMarkdown,
  shouldTreatAsFindings,
  type ReviewPromptInput
} from "./prompts";
import type { ReviewEngineEvent, ReviewResult, Reviewer } from "./review-engine";

const MAX_TOOL_ITERATIONS = 24;
const SHELL_TIMEOUT_MS = 60_000;
const SHELL_MAX_BUFFER = 4 * 1024 * 1024;
const TOOL_RESULT_MAX_CHARS = 6_000;
const MARKDOWN_PREVIEW_CHARS = 1500;

// Prefer bash so the model's bashisms ([[ ]], process substitution, brace ranges)
// work; fall back to sh on minimal images that lack bash.
const SHELL_PATH = existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";

type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

type ChatResponse = {
  choices: { message: { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }; finish_reason: string }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

export type OpenAICompatibleReviewEngineOptions = {
  maxToolIterations?: number;
};

export class OpenAICompatibleReviewEngine implements Reviewer {
  constructor(private readonly options: OpenAICompatibleReviewEngineOptions = {}) {}

  async review(
    input: ReviewPromptInput,
    onEvent?: (event: ReviewEngineEvent) => Promise<void> | void,
    settings?: CodexReviewRuntimeSettings,
    options: { signal?: AbortSignal } = {}
  ): Promise<ReviewResult> {
    const runtime = settings ?? defaultRuntimeSettings();
    if (runtime.provider !== "openai_compatible") {
      throw new Error("OpenAICompatibleReviewEngine requires the openai_compatible provider");
    }

    const workspace = input.workingDirectory ?? null;
    const { system, user } = splitPrompt(buildReviewPrompt(input));
    const systemContent = `${system}${workspaceNote(workspace)}${verificationNote(workspace)}`;
    const messages: ChatMessage[] = [
      { role: "system", content: systemContent },
      { role: "user", content: user }
    ];

    const usage = new UsageAccumulator();
    const enableThinking = runtime.reasoningEffort !== "minimal";

    // Phase 1: agentic repository exploration with read-only tools.
    if (workspace) {
      const maxIterations = this.options.maxToolIterations ?? MAX_TOOL_ITERATIONS;
      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        const response = await this.chat(runtime, messages, usage, options.signal, {
          tools: SHELL_TOOL,
          toolChoice: "auto",
          enableThinking
        });
        const message = response.choices[0]?.message;
        if (!message) throw new Error("AI provider returned no message during exploration");
        messages.push({ role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls });

        const toolCalls = message.tool_calls ?? [];
        if (toolCalls.length === 0) break;

        for (const call of toolCalls) {
          const result = await runShellTool(call, workspace, options.signal);
          await emitToolEvent(onEvent, result);
          messages.push({ role: "tool", tool_call_id: call.id, content: result.resultForModel });
        }
      }
    }

    // Phase 2: force the structured final review (tools off, json_schema on).
    messages.push({ role: "user", content: FINALIZE_INSTRUCTION });
    const finalResponse = await this.chat(runtime, messages, usage, options.signal, {
      responseFormat: REVIEW_OUTPUT_SCHEMA,
      enableThinking: false
    });
    const raw = (finalResponse.choices[0]?.message?.content ?? "").trim();
    if (!raw) throw new Error("AI review response was empty");

    const structured = parseStructuredReview(raw);
    const markdown = renderReviewMarkdown(structured);
    const hasFindings = shouldTreatAsFindings(structured);
    const finalUsage = usage.toUsage();

    await emit(onEvent, {
      level: "info",
      step: "codex_message",
      message: "AI provider produced final review response.",
      metadata: {
        responseBytes: Buffer.byteLength(raw, "utf8"),
        markdownPreview: truncate(markdown, MARKDOWN_PREVIEW_CHARS),
        assessment: structured.assessment,
        issueCount: structured.criticalIssues.length + structured.potentialIssues.length,
        hasFindings,
        provider: runtime.provider,
        providerLabel: runtime.providerLabel
      }
    });
    await emit(onEvent, {
      level: "info",
      step: "codex_usage",
      message: "AI provider turn usage recorded.",
      metadata: {
        inputTokens: finalUsage.input_tokens,
        outputTokens: finalUsage.output_tokens,
        totalTokens: finalUsage.input_tokens + finalUsage.output_tokens,
        provider: runtime.provider,
        providerLabel: runtime.providerLabel
      }
    });

    return { hasFindings, markdown, raw, structured, usage: finalUsage };
  }

  private async chat(
    runtime: CodexReviewRuntimeSettings & { provider: "openai_compatible" },
    messages: ChatMessage[],
    usage: UsageAccumulator,
    signal: AbortSignal | undefined,
    opts: { tools?: unknown; toolChoice?: string; responseFormat?: unknown; enableThinking?: boolean }
  ): Promise<ChatResponse> {
    const body: Record<string, unknown> = {
      model: runtime.model,
      messages,
      chat_template_kwargs: { enable_thinking: opts.enableThinking ?? false }
    };
    if (opts.tools) {
      body.tools = opts.tools;
      body.tool_choice = opts.toolChoice ?? "auto";
    }
    if (opts.responseFormat) {
      body.response_format = {
        type: "json_schema",
        json_schema: { name: "code_review", strict: true, schema: opts.responseFormat }
      };
    }

    const headers: Record<string, string> = { "content-type": "application/json" };
    if (runtime.apiKey) headers.authorization = `Bearer ${runtime.apiKey}`;

    const response = await fetch(`${runtime.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      ...(signal ? { signal } : {})
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenAI compatible request failed (${response.status}): ${text.slice(0, 500)}`);
    }
    const data = (await response.json()) as ChatResponse;
    usage.add(data.usage?.prompt_tokens, data.usage?.completion_tokens);
    return data;
  }
}

const SHELL_TOOL = [
  {
    type: "function",
    function: {
      name: "run_shell",
      description:
        "Run a shell command to inspect the code. The command ALREADY starts in the repository root (a disposable checkout in an isolated container), so use relative paths and never cd to absolute paths like /repo. Supports rg, git, cat, sed, ls, find, head, pipes, etc. There is no stdin, so always give search tools a path (e.g. 'rg pattern .', not 'rg pattern'). Prefer fast read-only inspection; avoid long-running, build, or network-heavy commands.",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: { command: { type: "string", description: "The read-only command to run." } },
        required: ["command"]
      }
    }
  }
];

const FINALIZE_INSTRUCTION =
  "Stop exploring. Now output ONLY the final code review as a single JSON object that matches the required schema. Do not include any prose, markdown, or code fences.";

type ToolRunResult = {
  command: string;
  status: "completed" | "failed";
  exitCode: number | null;
  resultForModel: string;
  outputPreview: string;
};

async function runShellTool(call: ToolCall, workspace: string, signal?: AbortSignal): Promise<ToolRunResult> {
  let command = "";
  try {
    const args = JSON.parse(call.function.arguments || "{}") as { command?: string };
    command = (args.command ?? "").trim();
  } catch {
    return failure("", "Invalid tool arguments JSON.");
  }
  if (!command) return failure("", "Empty command.");

  try {
    // The workspace is a disposable checkout inside an isolated container, so the
    // command runs as-is via the shell. Containment is the container's job; here we
    // only bound runtime and output size — and close stdin so search tools (rg/grep
    // with no path) read EOF instead of blocking on an open pipe.
    const { stdout, stderr, code, timedOut } = await runShell(command, {
      cwd: workspace,
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: SHELL_MAX_BUFFER,
      signal
    });
    const combined = redact([stdout, stderr].filter(Boolean).join("\n").trim());
    const ok = code === 0 && !timedOut;
    const fallback = timedOut ? `(killed: exceeded ${SHELL_TIMEOUT_MS}ms)` : ok ? "(no output)" : `(exit ${code ?? "signal"})`;
    return {
      command,
      status: ok ? "completed" : "failed",
      exitCode: code,
      resultForModel: truncate(combined || fallback, TOOL_RESULT_MAX_CHARS),
      outputPreview: truncate(combined || fallback, 800)
    };
  } catch (error) {
    return {
      command,
      status: "failed",
      exitCode: null,
      resultForModel: `Error: ${error instanceof Error ? error.message : String(error)}`,
      outputPreview: "error"
    };
  }
}

function failure(command: string, reason: string): ToolRunResult {
  return { command, status: "failed", exitCode: null, resultForModel: `Rejected: ${reason}`, outputPreview: reason };
}

class UsageAccumulator {
  private input = 0;
  private output = 0;
  add(prompt?: number, completion?: number): void {
    this.input += prompt ?? 0;
    this.output += completion ?? 0;
  }
  toUsage(): Usage {
    return {
      input_tokens: this.input,
      cached_input_tokens: 0,
      output_tokens: this.output,
      reasoning_output_tokens: 0
    } as Usage;
  }
}

function splitPrompt(full: string): { system: string; user: string } {
  const sep = full.search(/\n\s*USER:\s*\n/);
  if (sep < 0) return { system: "You are a senior software engineer performing a code review.", user: full };
  const system = full.slice(0, sep).replace(/^\s*SYSTEM:\s*\n?/, "").trim();
  const user = full.slice(sep).replace(/^\n\s*USER:\s*\n/, "").trim();
  return { system: system || "You are a senior software engineer performing a code review.", user };
}

function workspaceNote(workspace: string | null): string {
  if (!workspace) return "";
  return [
    "\n\n<workspace>",
    `The run_shell tool already starts in the repository root: ${workspace}`,
    'Every command runs from there. Use relative paths (e.g. "cat go.mod", "head -20 client.go"). Do NOT cd into absolute paths like /repo — they do not exist.',
    'The tool has no stdin, so search tools must be given a path: write "rg pattern ." or "grep -rn pattern ." — never "rg pattern" with no path (it would read empty stdin and find nothing).',
    "</workspace>"
  ].join("\n");
}

// Guards against knowledge-cutoff false positives: a local model's training data may
// predate the repo's toolchain, so it must verify "does not exist / won't compile"
// claims with the actual tooling instead of asserting them from memory.
function verificationNote(workspace: string | null): string {
  const lines = [
    "<verification>",
    "Your training data may be older than the language and toolchain versions this repository uses; recent releases add new standard-library and framework APIs you may not know.",
    "NEVER report that a symbol, function, or API 'does not exist', is 'undefined', or 'will not compile' based on memory alone."
  ];
  if (workspace) {
    lines.push(
      "Before reporting any such claim, verify it with the toolchain in this workspace — e.g. `go doc <pkg>.<Symbol>`, `go build ./...`, `go vet ./...` for Go; `npx tsc --noEmit` or the project linter for TS/JS. This overrides the 'do not run build commands' rule above, for read-only verification only (never modify files).",
      "If a verify/build command fails only because of missing network or dependencies, say so and lower the confidence — do not treat that as proof of a bug."
    );
  } else {
    lines.push(
      "You have no workspace to verify against, so describe any uncertain API or compile concern as a low-confidence note rather than a definitive issue."
    );
  }
  lines.push(
    "If you cannot verify an existence or compile claim, put it in notes with low confidence and mark it unverified — never in criticalIssues.",
    "</verification>"
  );
  return `\n\n${lines.join("\n")}`;
}

async function emitToolEvent(
  onEvent: ((event: ReviewEngineEvent) => Promise<void> | void) | undefined,
  result: ToolRunResult
): Promise<void> {
  await emit(onEvent, {
    level: result.status === "failed" ? "warn" : "info",
    step: "codex_tool_used",
    message: "AI provider executed a shell command for repository inspection.",
    metadata: {
      tool: "command_execution",
      command: result.command.slice(0, 500),
      status: result.status,
      exitCode: result.exitCode,
      outputPreview: result.outputPreview
    }
  });
}

async function emit(
  onEvent: ((event: ReviewEngineEvent) => Promise<void> | void) | undefined,
  event: ReviewEngineEvent
): Promise<void> {
  if (onEvent) await onEvent(event);
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}\n…(truncated)`;
}

function redact(value: string): string {
  return value
    .replace(/(Authorization:\s*)(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, "$1<redacted>")
    .replace(/(PRIVATE-TOKEN[=:\s]+)[A-Za-z0-9._-]+/gi, "$1<redacted>");
}

type ShellOutcome = { stdout: string; stderr: string; code: number | null; timedOut: boolean };

// Runs the command via bash (or sh) with stdin closed so tools that read stdin
// when given no path (rg, grep, cat) hit EOF instead of hanging. Bounds wall-clock
// time and captured output size, killing the process when exceeded.
function runShell(
  command: string,
  options: { cwd: string; timeout: number; maxBuffer: number; signal?: AbortSignal }
): Promise<ShellOutcome> {
  return new Promise((resolve, reject) => {
    const child = spawn(SHELL_PATH, ["-c", command], {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      ...(options.signal ? { signal: options.signal } : {})
    });

    let stdout = "";
    let stderr = "";
    let size = 0;
    let timedOut = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeout);

    const capture = (buf: Buffer, append: (text: string) => void): void => {
      if (size >= options.maxBuffer) return;
      const remaining = options.maxBuffer - size;
      if (buf.length <= remaining) {
        append(buf.toString("utf8"));
        size += buf.length;
      } else {
        append(buf.subarray(0, remaining).toString("utf8"));
        size = options.maxBuffer;
        child.kill("SIGKILL");
      }
    };
    child.stdout.on("data", (buf: Buffer) => capture(buf, (t) => (stdout += t)));
    child.stderr.on("data", (buf: Buffer) => capture(buf, (t) => (stderr += t)));

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ stdout, stderr, code, timedOut });
    });
  });
}
