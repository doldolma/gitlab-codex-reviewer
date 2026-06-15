import { defaultRuntimeSettings, type CodexReviewRuntimeSettings } from "./codex-review-settings";
import {
  REVIEW_OUTPUT_SCHEMA,
  buildReviewPrompt,
  parseStructuredReview,
  renderReviewMarkdown,
  shouldTreatAsFindings,
  type ReviewPromptInput
} from "./prompts";
import { runOpenAICompatibleAgent, splitPrompt, type ToolRunResult } from "./openai-compatible-agent";
import type { ReviewEngineEvent, ReviewResult, Reviewer } from "./review-engine";

const MARKDOWN_PREVIEW_CHARS = 1500;

export type OpenAICompatibleReviewEngineOptions = {
  maxToolIterations?: number;
  webTools?: boolean;
  searchUrl?: string | null;
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
    const { raw, usage } = await runOpenAICompatibleAgent({
      runtime: {
        baseUrl: runtime.baseUrl,
        apiKey: runtime.apiKey,
        model: runtime.model,
        contextWindow: runtime.contextWindow
      },
      system,
      user,
      outputSchema: REVIEW_OUTPUT_SCHEMA,
      schemaName: "code_review",
      workspace: input.workingDirectory ?? null,
      enableThinking: runtime.reasoningEffort !== "minimal",
      maxToolIterations: this.options.maxToolIterations,
      webTools: this.options.webTools,
      searchUrl: this.options.searchUrl,
      onToolEvent: (result) => emitToolEvent(onEvent, result),
      signal: options.signal
    });

    const structured = parseStructuredReview(raw);
    const markdown = renderReviewMarkdown(structured);
    const hasFindings = shouldTreatAsFindings(structured);

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
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        totalTokens: usage.input_tokens + usage.output_tokens,
        provider: runtime.provider,
        providerLabel: runtime.providerLabel
      }
    });

    return { hasFindings, markdown, raw, structured, usage };
  }
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
