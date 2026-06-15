import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxMode, ThreadEvent } from "@openai/codex-sdk";
import { createCodexRuntime, type CodexRuntimeBaseOptions } from "./codex-runtime";
import type { CodexReviewModelSettings } from "./codex-review-settings";

const VERIFY_TIMEOUT_MS = 180_000;
const VERIFY_MARKER = "openai-compatible-tool-check-ok";
const VERIFY_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    marker: { type: "string" }
  },
  required: ["marker"]
} as const;

export interface OpenAICompatibleVerifier {
  verify(settings: CodexReviewModelSettings): Promise<void>;
}

export class CodexOpenAICompatibleVerifier implements OpenAICompatibleVerifier {
  constructor(
    private readonly options: CodexRuntimeBaseOptions & { sandboxMode?: SandboxMode } = {}
  ) {}

  async verify(settings: CodexReviewModelSettings): Promise<void> {
    if (settings.provider !== "openai_compatible") {
      throw new Error("OpenAI compatible settings are required");
    }
    const workspace = await mkdtemp(join(tmpdir(), "gitlab-codex-provider-check-"));
    const markerPath = join(workspace, "provider-check.txt");
    await writeFile(markerPath, `${VERIFY_MARKER}\n`, "utf8");

    try {
      const codex = createCodexRuntime(this.options, settings);
      const thread = codex.startThread({
        model: settings.model,
        modelReasoningEffort: "xhigh",
        workingDirectory: workspace,
        skipGitRepoCheck: true,
        sandboxMode: this.options.sandboxMode ?? "read-only",
        approvalPolicy: "never"
      });
      const signal = AbortSignal.timeout(VERIFY_TIMEOUT_MS);
      const { events } = await thread.runStreamed(
        `Use a shell command to read provider-check.txt from the current workspace. Return JSON only with its exact content, trimmed, in the marker field.`,
        { outputSchema: VERIFY_OUTPUT_SCHEMA, signal }
      );
      await verifyEvents(events);
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error("OpenAI compatible provider verification timed out after 180 seconds");
      }
      throw error;
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

async function verifyEvents(events: AsyncGenerator<ThreadEvent>): Promise<void> {
  let usedShell = false;
  let finalResponse = "";
  let failure: string | null = null;

  for await (const event of events) {
    if (event.type === "item.completed" && event.item.type === "command_execution") {
      usedShell = true;
    }
    if (event.type === "item.completed" && event.item.type === "agent_message") {
      finalResponse = event.item.text;
    }
    if (event.type === "turn.failed") failure = event.error.message;
    if (event.type === "error") failure = event.message;
  }

  if (failure) throw new Error(failure);
  if (!usedShell) throw new Error("OpenAI compatible model did not use the required shell tool");

  const parsed = JSON.parse(stripJsonFence(finalResponse)) as { marker?: unknown };
  if (parsed.marker !== VERIFY_MARKER) {
    throw new Error("OpenAI compatible model returned an invalid structured verification response");
  }
}

function stripJsonFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}
