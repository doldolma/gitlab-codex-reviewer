import type { SandboxMode, ThreadEvent, Usage } from "@openai/codex-sdk";
import { defaultModelSettings, type CodexReviewRuntimeSettings } from "./codex-review-settings";
import { createCodexRuntime, type CodexRuntimeBaseOptions } from "./codex-runtime";
import { runOpenAICompatibleAgent, splitPrompt } from "./openai-compatible-agent";

const REPLY_MAX_OUTPUT_TOKENS = 4_096;

export type ReplyInput = {
  mrTitle: string;
  /** The comment that mentioned the bot. */
  question: string;
  /** The full discussion thread the comment belongs to. */
  threadText: string;
  /** The merge request diff. */
  diffText: string;
};

export type ReplyResult = { text: string; usage: Usage | null };

export interface Replier {
  reply(input: ReplyInput, settings?: CodexReviewRuntimeSettings, options?: { signal?: AbortSignal }): Promise<ReplyResult>;
}

const REPLY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: { reply: { type: "string" } },
  required: ["reply"]
} as const;

export function buildReplyPrompt(input: ReplyInput): string {
  return `SYSTEM:
You are an AI code reviewer replying to a developer's comment on a GitLab Merge Request.

- Answer ONLY the developer's latest question/comment, using the thread and the diff as context.
- Be concise, specific, and technical. Reply in Korean (ko-KR); keep code identifiers, paths, and API names in their original form.
- Ground every claim in the diff or thread. If you are unsure or the information is not available, say so plainly instead of guessing.
- If asked to make a change, explain or provide the snippet — you cannot edit files yourself.
- No greetings or filler. Markdown is allowed.

USER:

## Merge Request
${input.mrTitle}

## Discussion thread
${input.threadText || "(no prior messages)"}

## Developer comment to answer
${input.question}

## Diff
\`\`\`diff
${input.diffText}
\`\`\`

Write the reply.`;
}

export type OpenAICompatibleReplierOptions = { webTools?: boolean; searchUrl?: string | null };

export class OpenAICompatibleReplier implements Replier {
  constructor(private readonly options: OpenAICompatibleReplierOptions = {}) {}

  async reply(input: ReplyInput, settings?: CodexReviewRuntimeSettings, options: { signal?: AbortSignal } = {}): Promise<ReplyResult> {
    if (!settings || settings.provider !== "openai_compatible") {
      throw new Error("OpenAICompatibleReplier requires the openai_compatible provider");
    }
    const { system, user } = splitPrompt(buildReplyPrompt(input));
    const { raw, usage } = await runOpenAICompatibleAgent({
      runtime: { baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model, contextWindow: settings.contextWindow },
      system,
      user,
      outputSchema: REPLY_SCHEMA,
      schemaName: "mr_reply",
      workspace: null,
      enableThinking: settings.reasoningEffort !== "minimal",
      maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
      webTools: this.options.webTools,
      searchUrl: this.options.searchUrl,
      signal: options.signal
    });
    const parsed = JSON.parse(raw) as { reply?: unknown };
    const text = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
    if (!text) throw new Error("AI reply was empty");
    return { text, usage };
  }
}

export type CodexReplierOptions = CodexRuntimeBaseOptions & { sandboxMode?: SandboxMode };

export class CodexReplier implements Replier {
  constructor(private readonly options: CodexReplierOptions = {}) {}

  async reply(input: ReplyInput, settings?: CodexReviewRuntimeSettings, options: { signal?: AbortSignal } = {}): Promise<ReplyResult> {
    const runtime = settings ?? { ...defaultModelSettings(), reasoningEffort: "medium" as const };
    const codex = createCodexRuntime(this.options, runtime);
    const thread = codex.startThread({
      model: runtime.model,
      modelReasoningEffort: runtime.reasoningEffort,
      skipGitRepoCheck: true,
      sandboxMode: this.options.sandboxMode ?? "read-only",
      approvalPolicy: "never"
    });
    const { events } = await thread.runStreamed(buildReplyPrompt(input), {
      ...(options.signal ? { signal: options.signal } : {})
    });

    let text = "";
    let usage: Usage | null = null;
    let failure: string | null = null;
    for await (const event of events as AsyncGenerator<ThreadEvent>) {
      if (event.type === "item.completed" && event.item.type === "agent_message") text = event.item.text;
      if (event.type === "turn.completed") usage = event.usage;
      if (event.type === "turn.failed") failure = event.error.message;
      if (event.type === "error") failure = event.message;
    }
    if (failure) throw new Error(failure);
    const trimmed = text.trim();
    if (!trimmed) throw new Error("AI reply was empty");
    return { text: trimmed, usage };
  }
}

/** Dispatches a reply to the codex or OpenAI-compatible engine by provider. */
export class ProviderReplier implements Replier {
  constructor(
    private readonly codexReplier: Replier,
    private readonly compatibleReplier: Replier
  ) {}

  reply(input: ReplyInput, settings?: CodexReviewRuntimeSettings, options?: { signal?: AbortSignal }): Promise<ReplyResult> {
    const replier = settings?.provider === "openai_compatible" ? this.compatibleReplier : this.codexReplier;
    return replier.reply(input, settings, options);
  }
}
