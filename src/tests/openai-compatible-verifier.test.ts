import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexOpenAICompatibleVerifier } from "../lib/openai-compatible-verifier";

const codexMocks = vi.hoisted(() => {
  const runStreamed = vi.fn();
  const startThread = vi.fn(() => ({ runStreamed }));
  const Codex = vi.fn(function MockCodex() {
    return { startThread };
  });
  return { Codex, runStreamed, startThread };
});

vi.mock("@openai/codex-sdk", () => ({
  Codex: codexMocks.Codex
}));

const settings = {
  provider: "openai_compatible" as const,
  providerLabel: "OpenAI 호환 API",
  model: "qwen-coder",
  baseUrl: "http://qwen.internal:8000/v1",
  apiKey: null,
  contextWindow: 131072
};

describe("CodexOpenAICompatibleVerifier", () => {
  beforeEach(() => {
    codexMocks.Codex.mockClear();
    codexMocks.startThread.mockClear();
    codexMocks.runStreamed.mockReset();
  });

  it("requires a shell tool call and valid structured marker response", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: verificationEvents(true, "openai-compatible-tool-check-ok") });

    await expect(new CodexOpenAICompatibleVerifier().verify(settings)).resolves.toBeUndefined();
    expect(codexMocks.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "qwen-coder",
        modelReasoningEffort: "xhigh",
        sandboxMode: "read-only",
        approvalPolicy: "never"
      })
    );
    expect(codexMocks.runStreamed).toHaveBeenCalledWith(
      expect.stringContaining("provider-check.txt"),
      expect.objectContaining({ outputSchema: expect.any(Object), signal: expect.any(AbortSignal) })
    );
  });

  it("rejects a response that did not use the shell tool", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: verificationEvents(false, "openai-compatible-tool-check-ok") });

    await expect(new CodexOpenAICompatibleVerifier().verify(settings)).rejects.toThrow("did not use the required shell tool");
  });

  it("rejects an invalid structured response", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: verificationEvents(true, "wrong") });

    await expect(new CodexOpenAICompatibleVerifier().verify(settings)).rejects.toThrow("invalid structured verification response");
  });

  it("rejects malformed JSON output", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: malformedResponseEvents() });

    await expect(new CodexOpenAICompatibleVerifier().verify(settings)).rejects.toThrow(SyntaxError);
  });

  it("rejects an API turn failure", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: failedTurnEvents() });

    await expect(new CodexOpenAICompatibleVerifier().verify(settings)).rejects.toThrow("provider unavailable");
  });

  it("reports the verification timeout clearly", async () => {
    codexMocks.runStreamed.mockRejectedValue(new DOMException("timed out", "TimeoutError"));

    await expect(new CodexOpenAICompatibleVerifier().verify(settings)).rejects.toThrow(
      "verification timed out after 180 seconds"
    );
  });
});

async function* verificationEvents(includeTool: boolean, marker: string) {
  if (includeTool) {
    yield {
      type: "item.completed",
      item: {
        id: "cmd-1",
        type: "command_execution",
        command: "cat provider-check.txt",
        aggregated_output: `${marker}\n`,
        status: "completed",
        exit_code: 0
      }
    };
  }
  yield {
    type: "item.completed",
    item: {
      id: "msg-1",
      type: "agent_message",
      text: JSON.stringify({ marker })
    }
  };
  yield {
    type: "turn.completed",
    usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5, reasoning_output_tokens: 1 }
  };
}

async function* malformedResponseEvents() {
  yield {
    type: "item.completed",
    item: {
      id: "cmd-1",
      type: "command_execution",
      command: "cat provider-check.txt",
      aggregated_output: "openai-compatible-tool-check-ok\n",
      status: "completed",
      exit_code: 0
    }
  };
  yield {
    type: "item.completed",
    item: {
      id: "msg-1",
      type: "agent_message",
      text: "not json"
    }
  };
}

async function* failedTurnEvents() {
  yield {
    type: "turn.failed",
    error: { message: "provider unavailable" }
  };
}
