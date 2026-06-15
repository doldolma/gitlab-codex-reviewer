import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleReviewEngine } from "../lib/openai-compatible-review-engine";
import type { CodexReviewRuntimeSettings } from "../lib/codex-review-settings";
import type { ReviewEngineEvent } from "../lib/review-engine";
import type { ReviewPromptInput } from "../lib/prompts";

const settings: CodexReviewRuntimeSettings = {
  provider: "openai_compatible",
  providerLabel: "OpenAI 호환 API",
  model: "qwen-coder",
  baseUrl: "http://qwen.internal:8000/v1",
  apiKey: null,
  contextWindow: 131072,
  reasoningEffort: "high"
};

const STRUCTURED_REVIEW = JSON.stringify({
  reviewLanguage: "ko-KR",
  assessment: "safe",
  changeIntent: "테스트 변경",
  reviewEffort: { score: 1, reason: "간단함" },
  changedFilesSummary: [],
  riskAreas: [],
  summary: ["변경 요약"],
  criticalIssues: [],
  potentialIssues: [],
  suggestions: [],
  testSuggestions: [],
  notes: [],
  flowSummary: [],
  toolFindingsUsed: [],
  confidenceReason: "근거",
  shouldPostComment: false,
  commentReason: "없음"
});

function input(workingDirectory?: string): ReviewPromptInput {
  return {
    kind: "merge_request",
    repoName: "group/repo",
    sha: "abc123",
    diffText: "diff --git a/x b/x\n+console.log(1)",
    ...(workingDirectory ? { workingDirectory } : {})
  };
}

function chatJson(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

function errorResponse(status: number): Response {
  return { ok: false, status, json: async () => ({}), text: async () => `error ${status}` } as Response;
}

function htmlResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "text/html" } as unknown as Headers,
    text: async () => html,
    json: async () => ({})
  } as Response;
}

const toolCall = (name: string, args: unknown) => ({
  choices: [
    {
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name, arguments: JSON.stringify(args) } }]
      }
    }
  ],
  usage: { prompt_tokens: 8, completion_tokens: 4 }
});

const toolCallResponse = (command: string) => ({
  choices: [
    {
      finish_reason: "tool_calls",
      message: {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "c1", type: "function", function: { name: "run_shell", arguments: JSON.stringify({ command }) } }]
      }
    }
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5 }
});
const stopResponse = { choices: [{ finish_reason: "stop", message: { role: "assistant", content: null } }] };
const finalizeResponse = { choices: [{ finish_reason: "stop", message: { role: "assistant", content: STRUCTURED_REVIEW } }] };

afterEach(() => vi.unstubAllGlobals());

describe("OpenAICompatibleReviewEngine", () => {
  it("reviews from diff only when no workspace is available (single structured call)", async () => {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        calls.push(init ?? {});
        return chatJson(finalizeResponse);
      })
    );

    const engine = new OpenAICompatibleReviewEngine();
    const result = await engine.review(input(), undefined, settings);

    expect(result.structured.assessment).toBe("safe");
    expect(calls).toHaveLength(1);
    const body = JSON.parse(calls[0].body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.tools).toBeUndefined();
  });

  it("runs arbitrary shell (pipes, etc.) in the workspace, then finalizes structured JSON", async () => {
    const dir = mkdtempSync(join(tmpdir(), "review-engine-"));
    writeFileSync(join(dir, "notes.txt"), "SECRET_MARKER_42\n");
    try {
      const bodies: Record<string, unknown>[] = [];
      let exploreStep = 0;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string | URL, init?: RequestInit) => {
          const body = JSON.parse(init?.body as string);
          bodies.push(body);
          if (body.response_format) return chatJson(finalizeResponse);
          exploreStep += 1;
          if (exploreStep === 1) return chatJson(toolCallResponse("cat notes.txt | head -1")); // pipe runs
          if (exploreStep === 2) return chatJson(toolCallResponse("grep -c SECRET notes.txt")); // arbitrary cmd runs
          return chatJson(stopResponse);
        })
      );

      const events: ReviewEngineEvent[] = [];
      const engine = new OpenAICompatibleReviewEngine();
      const result = await engine.review(input(dir), (e) => void events.push(e), settings);

      expect(result.structured.assessment).toBe("safe");

      // The finalize request carries the full transcript, including tool results.
      const finalize = bodies.find((b) => b.response_format) as { messages: { role: string; content: string }[] };
      const toolResults = finalize.messages.filter((m) => m.role === "tool").map((m) => m.content);
      expect(toolResults.some((c) => c.includes("SECRET_MARKER_42"))).toBe(true); // piped read executed
      expect(toolResults.some((c) => c.startsWith("Rejected:"))).toBe(false); // no allowlist restrictions

      const toolEvents = events.filter((e) => e.step === "codex_tool_used");
      expect(toolEvents).toHaveLength(2);
      expect(toolEvents.every((e) => e.metadata?.status === "completed")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("retries transient errors then succeeds (#2)", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls += 1;
        return calls === 1 ? errorResponse(503) : chatJson(finalizeResponse);
      })
    );

    const result = await new OpenAICompatibleReviewEngine().review(input(), undefined, settings);
    expect(result.structured.assessment).toBe("safe");
    expect(calls).toBe(2);
  });

  it("does not retry deterministic 4xx errors", async () => {
    const fetchMock = vi.fn(async () => errorResponse(400));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OpenAICompatibleReviewEngine().review(input(), undefined, settings)).rejects.toThrow("(400)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("truncates oversized input to fit a small context window (#1)", async () => {
    let sentUser = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL, init?: RequestInit) => {
        sentUser = JSON.parse(init?.body as string).messages[1].content;
        return chatJson(finalizeResponse);
      })
    );

    const bigInput: ReviewPromptInput = { ...input(), diffText: "X".repeat(60_000) };
    await new OpenAICompatibleReviewEngine().review(bigInput, undefined, { ...settings, contextWindow: 9000 });

    expect(sentUser).toContain("input truncated");
    expect(sentUser.length).toBeLessThan(60_000);
  });

  it("uses fetch_url to read a page and feeds it back (web tools)", async () => {
    const bodies: Record<string, unknown>[] = [];
    let step = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith("/chat/completions")) {
          const body = JSON.parse(init?.body as string);
          bodies.push(body);
          if (body.response_format) return chatJson(finalizeResponse);
          step += 1;
          return step === 1
            ? chatJson(toolCall("fetch_url", { url: "https://pkg.go.dev/errors" }))
            : chatJson(stopResponse);
        }
        return htmlResponse("<html><body>func AsType[E error](err error) (E, bool)</body></html>");
      })
    );

    const result = await new OpenAICompatibleReviewEngine({ webTools: true }).review(input(), undefined, settings);

    expect(result.structured.assessment).toBe("safe");
    const explore = bodies.find((b) => (b as { tools?: unknown }).tools) as { tools: { function: { name: string } }[] };
    const toolNames = explore.tools.map((t) => t.function.name);
    expect(toolNames).toContain("fetch_url");
    expect(toolNames).not.toContain("web_search"); // no search backend configured
    const finalize = bodies.find((b) => b.response_format) as { messages: { role: string; content: string }[] };
    const toolResults = finalize.messages.filter((m) => m.role === "tool").map((m) => m.content);
    expect(toolResults.some((c) => c.includes("func AsType"))).toBe(true);
  });

  it("exposes web_search only when a search backend is configured, and queries it", async () => {
    const bodies: Record<string, unknown>[] = [];
    let step = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL, init?: RequestInit) => {
        if (String(url).endsWith("/chat/completions")) {
          const body = JSON.parse(init?.body as string);
          bodies.push(body);
          if (body.response_format) return chatJson(finalizeResponse);
          step += 1;
          return step === 1 ? chatJson(toolCall("web_search", { query: "errors.AsType go" })) : chatJson(stopResponse);
        }
        // SearXNG-style JSON backend
        return chatJson({ results: [{ title: "errors - pkg.go.dev", url: "https://pkg.go.dev/errors", content: "AsType finds the first error." }] });
      })
    );

    await new OpenAICompatibleReviewEngine({ webTools: true, searchUrl: "http://searx.local/search" }).review(input(), undefined, settings);

    const explore = bodies.find((b) => (b as { tools?: unknown }).tools) as { tools: { function: { name: string } }[] };
    expect(explore.tools.map((t) => t.function.name)).toContain("web_search");
    const finalize = bodies.find((b) => b.response_format) as { messages: { role: string; content: string }[] };
    const toolResults = finalize.messages.filter((m) => m.role === "tool").map((m) => m.content);
    expect(toolResults.some((c) => c.includes("https://pkg.go.dev/errors"))).toBe(true);
    expect(toolResults.some((c) => c.includes("AsType finds the first error"))).toBe(true);
  });
});
