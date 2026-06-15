import { execFile } from "node:child_process";
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
const SHELL_TIMEOUT_MS = 30_000;
const SHELL_MAX_BUFFER = 4 * 1024 * 1024;
const TOOL_RESULT_MAX_CHARS = 6_000;
const MARKDOWN_PREVIEW_CHARS = 1500;

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

    const { system, user } = splitPrompt(buildReviewPrompt(input));
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      { role: "user", content: user }
    ];

    const workspace = input.workingDirectory ?? null;
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
        "Run a shell command in the repository workspace to inspect the code (rg, git, cat, sed, ls, find, head, pipes, etc.). The workspace is a disposable checkout in an isolated container. Prefer fast read-only inspection; avoid long-running, build, or network-heavy commands.",
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
    // only bound runtime and output size.
    const { stdout, stderr } = await execFileAsync("/bin/sh", ["-c", command], {
      cwd: workspace,
      timeout: SHELL_TIMEOUT_MS,
      maxBuffer: SHELL_MAX_BUFFER,
      signal
    });
    const combined = redact([stdout, stderr].filter(Boolean).join("\n").trim());
    return {
      command,
      status: "completed",
      exitCode: 0,
      resultForModel: truncate(combined || "(no output)", TOOL_RESULT_MAX_CHARS),
      outputPreview: truncate(combined, 800)
    };
  } catch (error) {
    const e = error as { code?: number | string; stdout?: string; stderr?: string; message?: string };
    const combined = redact([e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim());
    return {
      command,
      status: "failed",
      exitCode: typeof e.code === "number" ? e.code : null,
      resultForModel: truncate(combined || "(command failed)", TOOL_RESULT_MAX_CHARS),
      outputPreview: truncate(combined, 800)
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

function execFileAsync(
  file: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number; signal?: AbortSignal }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { ...options, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) reject(Object.assign(error, { stdout, stderr }));
      else resolve({ stdout, stderr });
    });
  });
}
