import { Codex, type SandboxMode, type ThreadEvent, type Usage } from "@openai/codex-sdk";
import {
  DEFAULT_CODEX_REVIEW_MODEL,
  DEFAULT_CODEX_REVIEW_REASONING_EFFORT,
  type CodexReviewReasoningEffort,
  type CodexReviewRuntimeSettings
} from "./codex-review-settings";
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

export interface ReleaseNoteWriter {
  write(input: ReleaseNotePromptInput, settings?: CodexReviewRuntimeSettings, options?: { signal?: AbortSignal }): Promise<ReleaseNoteResult>;
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
    settings?: CodexReviewRuntimeSettings,
    options: { signal?: AbortSignal } = {}
  ): Promise<ReleaseNoteResult> {
    const codex = new Codex({
      ...(this.options.codexBin ? { codexPathOverride: this.options.codexBin } : {}),
      env: codexEnv(this.options.codexHome)
    });
    const thread = codex.startThread({
      model: settings?.model ?? this.options.model ?? DEFAULT_CODEX_REVIEW_MODEL,
      modelReasoningEffort: settings?.reasoningEffort ?? this.options.modelReasoningEffort ?? DEFAULT_CODEX_REVIEW_REASONING_EFFORT,
      skipGitRepoCheck: true,
      sandboxMode: this.options.sandboxMode ?? "read-only",
      approvalPolicy: "never"
    });

    const { events } = await thread.runStreamed(buildReleaseNotePrompt(input), {
      outputSchema: RELEASE_NOTE_OUTPUT_SCHEMA,
      ...(options.signal ? { signal: options.signal } : {})
    });
    const { finalResponse, usage } = await collectFinalResponse(events);
    const raw = finalResponse.trim();
    if (!raw) throw new Error("Codex release note response was empty");

    const structured = parseStructuredReleaseNote(raw);
    return {
      markdown: renderReleaseNoteMarkdown(structured),
      raw,
      structured,
      usage
    };
  }
}

async function collectFinalResponse(events: AsyncGenerator<ThreadEvent>): Promise<{ finalResponse: string; usage: Usage | null }> {
  let finalResponse = "";
  let usage: Usage | null = null;
  let failure: string | null = null;

  for await (const event of events) {
    if (event.type === "item.completed" && event.item.type === "agent_message") {
      finalResponse = event.item.text;
    }
    if (event.type === "turn.completed") {
      usage = event.usage;
    }
    if (event.type === "turn.failed") {
      failure = event.error.message;
    }
    if (event.type === "error") {
      failure = event.message;
    }
  }

  if (failure) throw new Error(failure);
  return { finalResponse, usage };
}

function codexEnv(codexHome?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (codexHome) env.CODEX_HOME = codexHome;
  return env;
}
