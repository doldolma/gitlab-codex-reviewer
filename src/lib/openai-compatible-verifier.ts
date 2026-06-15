import type { CodexReviewModelSettings } from "./codex-review-settings";

const VERIFY_TIMEOUT_MS = 20_000;

export interface OpenAICompatibleVerifier {
  verify(settings: CodexReviewModelSettings): Promise<void>;
}

/**
 * Verifies an OpenAI-compatible endpoint directly (no codex subprocess):
 * confirms the base URL is reachable, the configured model is served, and a
 * minimal chat completion succeeds with the provided credentials.
 */
export class OpenAICompatibleConnectionVerifier implements OpenAICompatibleVerifier {
  constructor(private readonly options: { timeoutMs?: number } = {}) {}

  async verify(settings: CodexReviewModelSettings): Promise<void> {
    if (settings.provider !== "openai_compatible") {
      throw new Error("OpenAI compatible settings are required");
    }
    const timeout = this.options.timeoutMs ?? VERIFY_TIMEOUT_MS;
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (settings.apiKey) headers.authorization = `Bearer ${settings.apiKey}`;

    await this.assertModelServed(settings, headers, timeout);
    await this.assertChatWorks(settings, headers, timeout);
  }

  private async assertModelServed(
    settings: CodexReviewModelSettings & { provider: "openai_compatible" },
    headers: Record<string, string>,
    timeout: number
  ): Promise<void> {
    const response = await this.request(`${settings.baseUrl}/models`, { method: "GET", headers }, timeout);
    if (!response.ok) {
      throw new Error(`models endpoint returned ${response.status}: ${(await safeText(response)).slice(0, 300)}`);
    }
    const data = (await response.json()) as { data?: { id?: string }[] };
    const ids = (data.data ?? []).map((m) => m.id).filter((id): id is string => Boolean(id));
    if (ids.length > 0 && !ids.includes(settings.model)) {
      throw new Error(`model "${settings.model}" is not served. Available: ${ids.slice(0, 10).join(", ")}`);
    }
  }

  private async assertChatWorks(
    settings: CodexReviewModelSettings & { provider: "openai_compatible" },
    headers: Record<string, string>,
    timeout: number
  ): Promise<void> {
    const response = await this.request(
      `${settings.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1
        })
      },
      timeout
    );
    if (!response.ok) {
      throw new Error(`chat/completions returned ${response.status}: ${(await safeText(response)).slice(0, 300)}`);
    }
  }

  private async request(url: string, init: RequestInit, timeout: number): Promise<Response> {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error(`request to ${url} timed out after ${timeout}ms`);
      }
      throw new Error(`request to ${url} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
