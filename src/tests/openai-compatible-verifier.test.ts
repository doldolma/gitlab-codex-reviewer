import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAICompatibleConnectionVerifier } from "../lib/openai-compatible-verifier";

const settings = {
  provider: "openai_compatible" as const,
  providerLabel: "OpenAI 호환 API",
  model: "qwen-coder",
  baseUrl: "http://qwen.internal:8000/v1",
  apiKey: null,
  contextWindow: 131072
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response;
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL, init?: RequestInit) => handler(String(url), init))
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAICompatibleConnectionVerifier", () => {
  it("resolves when the model is served and chat works", async () => {
    mockFetch((url) =>
      url.endsWith("/models")
        ? jsonResponse({ data: [{ id: "qwen-coder" }] })
        : jsonResponse({ choices: [{ message: { content: "" } }] })
    );

    await expect(new OpenAICompatibleConnectionVerifier().verify(settings)).resolves.toBeUndefined();
  });

  it("resolves when /models does not enumerate ids (only chat matters)", async () => {
    mockFetch((url) => (url.endsWith("/models") ? jsonResponse({}) : jsonResponse({ choices: [] })));

    await expect(new OpenAICompatibleConnectionVerifier().verify(settings)).resolves.toBeUndefined();
  });

  it("rejects when the configured model is not served", async () => {
    mockFetch(() => jsonResponse({ data: [{ id: "other-model" }] }));

    await expect(new OpenAICompatibleConnectionVerifier().verify(settings)).rejects.toThrow(
      'model "qwen-coder" is not served'
    );
  });

  it("rejects when the models endpoint errors", async () => {
    mockFetch(() => jsonResponse({ error: "nope" }, false, 502));

    await expect(new OpenAICompatibleConnectionVerifier().verify(settings)).rejects.toThrow("models endpoint returned 502");
  });

  it("rejects when chat/completions errors", async () => {
    mockFetch((url) =>
      url.endsWith("/models") ? jsonResponse({ data: [{ id: "qwen-coder" }] }) : jsonResponse({ error: "bad" }, false, 400)
    );

    await expect(new OpenAICompatibleConnectionVerifier().verify(settings)).rejects.toThrow(
      "chat/completions returned 400"
    );
  });

  it("reports a timeout clearly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("timed out", "TimeoutError");
      })
    );

    await expect(new OpenAICompatibleConnectionVerifier().verify(settings)).rejects.toThrow("timed out after");
  });

  it("sends the bearer token when an api key is configured", async () => {
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) =>
      String(url).endsWith("/models") ? jsonResponse({ data: [{ id: "qwen-coder" }] }) : jsonResponse({ choices: [] })
    );
    vi.stubGlobal("fetch", fetchMock);

    await new OpenAICompatibleConnectionVerifier().verify({ ...settings, apiKey: "secret-key" });

    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret-key");
  });
});
