import { Codex, type ThreadEvent, type ThreadItem, type Usage } from "@openai/codex-sdk";
import {
  DEFAULT_CODEX_REVIEW_MODEL,
  DEFAULT_CODEX_REVIEW_REASONING_EFFORT,
  type CodexReviewReasoningEffort,
  type CodexReviewRuntimeSettings
} from "./codex-review-settings";
import {
  REVIEW_OUTPUT_SCHEMA,
  buildReviewPrompt,
  parseStructuredReview,
  renderReviewMarkdown,
  shouldTreatAsFindings,
  type ReviewPromptInput,
  type StructuredReview
} from "./prompts";

export const REVIEW_MODEL = DEFAULT_CODEX_REVIEW_MODEL;
export const REVIEW_REASONING_EFFORT = DEFAULT_CODEX_REVIEW_REASONING_EFFORT;
const MARKDOWN_PREVIEW_CHARS = 1500;
const TOOL_OUTPUT_PREVIEW_CHARS = 2000;
const TOOL_OUTPUT_PREVIEW_LINES = 40;

export type ReviewResult = {
  hasFindings: boolean;
  markdown: string;
  raw: string;
  structured: StructuredReview;
  usage: Usage | null;
};

export type ReviewEngineEvent = {
  level: "info" | "warn" | "error";
  step: "codex_tool_used" | "codex_message" | "codex_usage" | "codex_failed";
  message: string;
  metadata?: Record<string, unknown>;
};

export interface Reviewer {
  review(
    input: ReviewPromptInput,
    onEvent?: (event: ReviewEngineEvent) => Promise<void> | void,
    settings?: CodexReviewRuntimeSettings
  ): Promise<ReviewResult>;
}

export type CodexReviewEngineOptions = {
  codexBin?: string;
  codexHome?: string;
  model?: string;
  modelReasoningEffort?: CodexReviewReasoningEffort;
};

export class CodexReviewEngine implements Reviewer {
  constructor(private readonly options: CodexReviewEngineOptions = {}) {}

  async review(
    input: ReviewPromptInput,
    onEvent?: (event: ReviewEngineEvent) => Promise<void> | void,
    settings?: CodexReviewRuntimeSettings
  ): Promise<ReviewResult> {
    const codex = new Codex({
      ...(this.options.codexBin ? { codexPathOverride: this.options.codexBin } : {}),
      env: codexEnv(this.options.codexHome)
    });
    const thread = codex.startThread({
      model: settings?.model ?? this.options.model ?? REVIEW_MODEL,
      modelReasoningEffort: settings?.reasoningEffort ?? this.options.modelReasoningEffort ?? REVIEW_REASONING_EFFORT,
      ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never"
    });

    const prompt = buildReviewPrompt(input);
    const { events } = await thread.runStreamed(prompt, { outputSchema: REVIEW_OUTPUT_SCHEMA });
    const { finalResponse, usage } = await collectReviewEvents(events, onEvent);
    const raw = finalResponse.trim();
    if (!raw) throw new Error("Codex review response was empty");

    const structured = parseStructuredReview(raw);
    const markdown = renderReviewMarkdown(structured);
    const hasFindings = shouldTreatAsFindings(structured);
    await emit(onEvent, {
      level: "info",
      step: "codex_message",
      message: "Codex produced final review response.",
      metadata: {
        responseBytes: Buffer.byteLength(raw, "utf8"),
        markdownPreview: truncateText(markdown, MARKDOWN_PREVIEW_CHARS).text,
        markdownPreviewTruncated: truncateText(markdown, MARKDOWN_PREVIEW_CHARS).truncated,
        assessment: structured.assessment,
        issueCount: structured.criticalIssues.length + structured.potentialIssues.length,
        hasFindings
      }
    });
    if (usage) {
      await emit(onEvent, {
        level: "info",
        step: "codex_usage",
        message: "Codex turn usage recorded.",
        metadata: {
          inputTokens: usage.input_tokens,
          cachedInputTokens: usage.cached_input_tokens,
          outputTokens: usage.output_tokens,
          reasoningOutputTokens: usage.reasoning_output_tokens,
          totalTokens: usage.input_tokens + usage.output_tokens
        }
      });
    }
    return {
      hasFindings,
      markdown,
      raw,
      structured,
      usage
    };
  }
}

async function collectReviewEvents(
  events: AsyncGenerator<ThreadEvent>,
  onEvent?: (event: ReviewEngineEvent) => Promise<void> | void
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
          message: "Codex turn failed.",
          metadata: { error: event.error.message }
        });
        break;
      case "error":
        failure = event.message;
        await emit(onEvent, {
          level: "error",
          step: "codex_failed",
          message: "Codex stream failed.",
          metadata: { error: event.message }
        });
        break;
    }
  }

  if (failure) throw new Error(failure);
  return { finalResponse, usage };
}

async function emitToolEvent(onEvent: ((event: ReviewEngineEvent) => Promise<void> | void) | undefined, item: ThreadItem): Promise<void> {
  if (item.type === "command_execution") {
    const outputPreview = previewOutput(item.aggregated_output ?? "");
    await emit(onEvent, {
      level: item.status === "failed" ? "warn" : "info",
      step: "codex_tool_used",
      message: "Codex executed a read-only command.",
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
      message: "Codex used an MCP tool.",
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
      message: "Codex requested web search.",
      metadata: { tool: "web_search", query: sanitizeCommand(item.query) }
    });
    return;
  }

  if (item.type === "file_change") {
    await emit(onEvent, {
      level: "warn",
      step: "codex_tool_used",
      message: "Codex attempted a file change in read-only review.",
      metadata: {
        tool: "file_change",
        status: item.status,
        changedFiles: item.changes.map((change) => change.path).slice(0, 20)
      }
    });
  }
}

async function emit(onEvent: ((event: ReviewEngineEvent) => Promise<void> | void) | undefined, event: ReviewEngineEvent): Promise<void> {
  if (onEvent) await onEvent(event);
}

function sanitizeCommand(command: string): string {
  return redactSensitive(command)
    .slice(0, 500);
}

function previewOutput(output: string): { text: string; truncated: boolean } {
  const redacted = redactSensitive(output);
  const lines = redacted.split(/\r?\n/);
  const lineLimited = lines.slice(0, TOOL_OUTPUT_PREVIEW_LINES).join("\n");
  const truncated = lines.length > TOOL_OUTPUT_PREVIEW_LINES || lineLimited.length > TOOL_OUTPUT_PREVIEW_CHARS;
  return truncateText(lineLimited, TOOL_OUTPUT_PREVIEW_CHARS, truncated);
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

function codexEnv(codexHome?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (codexHome) env.CODEX_HOME = codexHome;
  return env;
}
