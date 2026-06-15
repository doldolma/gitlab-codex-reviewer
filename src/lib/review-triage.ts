import type { SandboxMode, ThreadEvent, Usage } from "@openai/codex-sdk";
import {
  TRIAGE_CODEX_REVIEW_REASONING_EFFORT,
  type CodexReviewModelSettings,
  type CodexReviewReasoningEffort
} from "./codex-review-settings";
import { createCodexRuntime } from "./codex-runtime";
import type { ReviewPromptInput } from "./prompts";
import { REVIEW_PROMPT_VERSION } from "./prompts";
import type { ReviewRiskLevel } from "./review-strategy";

export const TRIAGE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    recommendedReasoningEffort: { type: "string", enum: ["medium", "high", "xhigh"] },
    riskLevel: { type: "string", enum: ["low", "medium", "high"] },
    reason: { type: "string" },
    riskSignals: { type: "array", items: { type: "string" } }
  },
  required: ["recommendedReasoningEffort", "riskLevel", "reason", "riskSignals"]
} as const;

export type ReviewTriageInput = ReviewPromptInput & {
  changedFiles: string[];
  diffBytes: number;
  diffTruncated: boolean;
  omittedFiles: number;
};

export type ReviewTriageResult = {
  recommendedReasoningEffort: Extract<CodexReviewReasoningEffort, "medium" | "high" | "xhigh">;
  riskLevel: ReviewRiskLevel;
  reason: string;
  riskSignals: string[];
  raw: string;
  usage: Usage | null;
};

export type CodexReviewTriageEngineOptions = {
  codexBin?: string;
  codexHome?: string;
  sandboxMode?: SandboxMode;
};

export interface ReviewTriageRunner {
  triage(input: ReviewTriageInput, settings: CodexReviewModelSettings, options?: { signal?: AbortSignal }): Promise<ReviewTriageResult>;
}

export class CodexReviewTriageEngine implements ReviewTriageRunner {
  constructor(private readonly options: CodexReviewTriageEngineOptions = {}) {}

  async triage(input: ReviewTriageInput, settings: CodexReviewModelSettings, options: { signal?: AbortSignal } = {}): Promise<ReviewTriageResult> {
    const codex = createCodexRuntime(this.options, settings);
    const thread = codex.startThread({
      model: settings.model,
      modelReasoningEffort: TRIAGE_CODEX_REVIEW_REASONING_EFFORT,
      ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
      skipGitRepoCheck: true,
      sandboxMode: this.options.sandboxMode ?? "read-only",
      approvalPolicy: "never"
    });

    const { events } = await thread.runStreamed(buildTriagePrompt(input), {
      outputSchema: TRIAGE_OUTPUT_SCHEMA,
      ...(options.signal ? { signal: options.signal } : {})
    });
    const { finalResponse, usage } = await collectFinalResponse(events);
    const raw = finalResponse.trim();
    if (!raw) throw new Error("AI triage response was empty");

    return {
      ...parseTriageResult(raw),
      raw,
      usage
    };
  }
}

function buildTriagePrompt(input: ReviewTriageInput): string {
  const reviewType = input.kind === "commit" ? "GitLab commit" : "GitLab Merge Request";
  return `SYSTEM:
You decide the reasoning effort for a later professional code review.

You MUST NOT perform the full code review.
You MUST NOT report findings or suggestions.
Your only task is to estimate the risk and choose the minimum sufficient reasoning effort for the final review.
All human-readable output strings must be Korean.

Use medium for small, localized, low-risk changes.
Use high for normal feature work, moderate cross-file impact, or uncertain contracts.
Use xhigh only when the change likely needs deep reasoning: auth/security, permissions, tokens, data loss, DB/schema/migration, concurrency/locks, scheduler/worker, webhooks, API contract changes, complex lifecycle changes, large diffs, or risky refactors.

Return JSON only.

USER:

Repository: ${input.repoName}
Review type: ${reviewType}
Base: ${input.baseRef ?? "unknown"}
Head: ${input.headRef ?? "unknown"}
SHA: ${input.sha}
Branch: ${input.branchName ?? "unknown"}
Prompt version: ${REVIEW_PROMPT_VERSION}
Diff bytes: ${input.diffBytes}
Diff truncated: ${input.diffTruncated ? "yes" : "no"}
Omitted files: ${input.omittedFiles}

Changed files:
${input.changedFiles.length ? input.changedFiles.map((file) => `- ${file}`).join("\n") : "- unknown"}

Diff:
\`\`\`diff
${input.diffText}
\`\`\`

Decide recommendedReasoningEffort, riskLevel, reason, and riskSignals.`;
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

function parseTriageResult(raw: string): Omit<ReviewTriageResult, "raw" | "usage"> {
  const parsed = JSON.parse(stripJsonFence(raw)) as unknown;
  if (!isRecord(parsed)) throw new Error("AI triage response was not a JSON object");
  return {
    recommendedReasoningEffort: parseTriageReasoning(parsed.recommendedReasoningEffort),
    riskLevel: parseRiskLevel(parsed.riskLevel),
    reason: parseString(parsed.reason, "reason"),
    riskSignals: parseStringArray(parsed.riskSignals, "riskSignals")
  };
}

function parseTriageReasoning(value: unknown): Extract<CodexReviewReasoningEffort, "medium" | "high" | "xhigh"> {
  if (value === "medium" || value === "high" || value === "xhigh") return value;
  throw new Error("AI triage response has invalid recommendedReasoningEffort");
}

function parseRiskLevel(value: unknown): ReviewRiskLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("AI triage response has invalid riskLevel");
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`AI triage response has invalid ${field}`);
  return value.map((item) => parseString(item, field));
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`AI triage response has invalid ${field}`);
  return value;
}

function stripJsonFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
