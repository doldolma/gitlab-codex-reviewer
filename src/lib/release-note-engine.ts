import type { SandboxMode, ThreadEvent, ThreadItem, Usage } from "@openai/codex-sdk";
import {
  DEFAULT_CODEX_REVIEW_MODEL,
  DEFAULT_CODEX_REVIEW_REASONING_EFFORT,
  defaultRuntimeSettings,
  type CodexReviewReasoningEffort,
  type CodexReviewRuntimeSettings
} from "./codex-review-settings";
import { createCodexRuntime } from "./codex-runtime";
import {
  RELEASE_NOTE_OUTPUT_SCHEMA,
  buildReleaseNotePrompt,
  parseStructuredReleaseNote,
  renderReleaseNoteMarkdown,
  type ReleaseNotePromptInput,
  type StructuredReleaseNote
} from "./release-note-prompts";

export type ReleaseNoteResult = {
  markdown: string;
  raw: string;
  structured: StructuredReleaseNote;
  usage: Usage | null;
};

export type ReleaseNoteEngineEvent = {
  level: "info" | "warn" | "error";
  step: "codex_tool_used" | "codex_message" | "codex_usage" | "codex_failed";
  message: string;
  metadata?: Record<string, unknown>;
};

export interface ReleaseNoteWriter {
  write(
    input: ReleaseNotePromptInput,
    onEvent?: (event: ReleaseNoteEngineEvent) => Promise<void> | void,
    settings?: CodexReviewRuntimeSettings,
    options?: { signal?: AbortSignal }
  ): Promise<ReleaseNoteResult>;
}

export type CodexReleaseNoteEngineOptions = {
  codexBin?: string;
  codexHome?: string;
  model?: string;
  modelReasoningEffort?: CodexReviewReasoningEffort;
  sandboxMode?: SandboxMode;
};

export class CodexReleaseNoteEngine implements ReleaseNoteWriter {
  constructor(private readonly options: CodexReleaseNoteEngineOptions = {}) {}

  async write(
    input: ReleaseNotePromptInput,
    onEvent?: (event: ReleaseNoteEngineEvent) => Promise<void> | void,
    settings?: CodexReviewRuntimeSettings,
    options: { signal?: AbortSignal } = {}
  ): Promise<ReleaseNoteResult> {
    const runtime = settings ?? {
      ...defaultRuntimeSettings(),
      model: this.options.model ?? DEFAULT_CODEX_REVIEW_MODEL,
      reasoningEffort: this.options.modelReasoningEffort ?? DEFAULT_CODEX_REVIEW_REASONING_EFFORT
    };
    const codex = createCodexRuntime(this.options, runtime);
    const thread = codex.startThread({
      model: runtime.model,
      modelReasoningEffort: runtime.reasoningEffort,
      ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
      skipGitRepoCheck: true,
      sandboxMode: this.options.sandboxMode ?? "read-only",
      approvalPolicy: "never"
    });

    const { events } = await thread.runStreamed(buildReleaseNotePrompt(input), {
      outputSchema: RELEASE_NOTE_OUTPUT_SCHEMA,
      ...(options.signal ? { signal: options.signal } : {})
    });
    const { finalResponse, usage } = await collectReleaseNoteEvents(events, onEvent);
    const raw = finalResponse.trim();
    if (!raw) throw new Error("AI release note response was empty");

    const structured = parseStructuredReleaseNote(raw);
    await emit(onEvent, {
      level: "info",
      step: "codex_message",
      message: "AI provider produced final release note response.",
      metadata: {
        responseBytes: Buffer.byteLength(raw, "utf8"),
        title: structured.title,
        highlightCount: structured.highlights.length,
        improvementCount: structured.improvements.length,
        fixCount: structured.fixes.length,
        provider: runtime.provider,
        providerLabel: runtime.providerLabel
      }
    });
    if (usage) {
      await emit(onEvent, {
        level: "info",
        step: "codex_usage",
        message: "AI provider release note usage recorded.",
        metadata: {
          inputTokens: usage.input_tokens,
          cachedInputTokens: usage.cached_input_tokens,
          outputTokens: usage.output_tokens,
          reasoningOutputTokens: usage.reasoning_output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens,
          provider: runtime.provider,
          providerLabel: runtime.providerLabel
        }
      });
    }
    return {
      markdown: renderReleaseNoteMarkdown(structured),
      raw,
      structured,
      usage
    };
  }
}

async function collectReleaseNoteEvents(
  events: AsyncGenerator<ThreadEvent>,
  onEvent?: (event: ReleaseNoteEngineEvent) => Promise<void> | void
): Promise<{ finalResponse: string; usage: Usage | null }> {
  let finalResponse = "";
  let usage: Usage | null = null;
  let failure: string | null = null;

  for await (const event of events) {
    switch (event.type) {
      case "item.completed":
        if (event.item.type === "agent_message") {
          finalResponse = event.item.text;
        } else {
          await emitToolEvent(onEvent, event.item);
        }
        break;
      case "turn.completed":
        usage = event.usage;
        break;
      case "turn.failed":
        failure = event.error.message;
        await emit(onEvent, {
          level: "error",
          step: "codex_failed",
          message: "AI provider release note turn failed.",
          metadata: { error: event.error.message }
        });
        break;
      case "error":
        failure = event.message;
        await emit(onEvent, {
          level: "error",
          step: "codex_failed",
          message: "AI provider release note stream failed.",
          metadata: { error: event.message }
        });
        break;
    }
  }

  if (failure) throw new Error(failure);
  return { finalResponse, usage };
}

async function emitToolEvent(
  onEvent: ((event: ReleaseNoteEngineEvent) => Promise<void> | void) | undefined,
  item: ThreadItem
): Promise<void> {
  if (item.type === "command_execution") {
    const outputPreview = previewOutput(item.aggregated_output ?? "");
    await emit(onEvent, {
      level: item.status === "failed" ? "warn" : "info",
      step: "codex_tool_used",
      message: "AI provider executed a shell command for release note context.",
      metadata: {
        tool: "command_execution",
        command: sanitizeCommand(item.command),
        status: item.status,
        exitCode: item.exit_code ?? null,
        outputBytes: Buffer.byteLength(item.aggregated_output ?? "", "utf8"),
        outputPreview: outputPreview.text,
        outputTruncated: outputPreview.truncated
      }
    });
    return;
  }

  if (item.type === "mcp_tool_call") {
    await emit(onEvent, {
      level: item.status === "failed" ? "warn" : "info",
      step: "codex_tool_used",
      message: "AI provider used an MCP tool for release note context.",
      metadata: {
        tool: item.tool,
        server: item.server,
        status: item.status,
        error: item.error?.message ?? null
      }
    });
    return;
  }

  if (item.type === "web_search") {
    await emit(onEvent, {
      level: "info",
      step: "codex_tool_used",
      message: "AI provider requested web search for release note context.",
      metadata: { tool: "web_search", query: sanitizeCommand(item.query) }
    });
    return;
  }

  if (item.type === "file_change") {
    await emit(onEvent, {
      level: "warn",
      step: "codex_tool_used",
      message: "AI provider attempted a file change while writing release notes.",
      metadata: {
        tool: "file_change",
        status: item.status,
        changedFiles: item.changes.map((change) => change.path).slice(0, 20)
      }
    });
  }
}

async function emit(
  onEvent: ((event: ReleaseNoteEngineEvent) => Promise<void> | void) | undefined,
  event: ReleaseNoteEngineEvent
): Promise<void> {
  if (onEvent) await onEvent(event);
}

function sanitizeCommand(command: string): string {
  return redactSensitive(command).slice(0, 500);
}

function previewOutput(output: string): { text: string; truncated: boolean } {
  const redacted = redactSensitive(output);
  const lines = redacted.split(/\r?\n/);
  const lineLimited = lines.slice(0, 40).join("\n");
  const truncated = lines.length > 40 || lineLimited.length > 2000;
  return truncateText(lineLimited, 2000, truncated);
}

function truncateText(value: string, maxChars: number, alreadyTruncated = false): { text: string; truncated: boolean } {
  if (value.length <= maxChars) return { text: value, truncated: alreadyTruncated };
  return { text: value.slice(0, maxChars), truncated: true };
}

function redactSensitive(value: string): string {
  return value
    .replace(/(Authorization:\s*)(Basic|Bearer)\s+[A-Za-z0-9+/=._-]+/gi, "$1<redacted>")
    .replace(/(PRIVATE-TOKEN[=:\s]+)[A-Za-z0-9._-]+/gi, "$1<redacted>");
}
