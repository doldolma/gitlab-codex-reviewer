import { Codex, type CodexOptions } from "@openai/codex-sdk";
import type { CodexReviewRuntimeSettings } from "./codex-review-settings";

const COMPATIBLE_PROVIDER_ID = "openai_compatible";
const COMPATIBLE_API_KEY_ENV = "OPENAI_COMPATIBLE_API_KEY";
const COMPATIBLE_DUMMY_API_KEY = "vllm-local";

export type CodexRuntimeBaseOptions = {
  codexBin?: string;
  codexHome?: string;
};

export function createCodexRuntime(
  options: CodexRuntimeBaseOptions,
  settings: Pick<CodexReviewRuntimeSettings, "provider" | "baseUrl" | "apiKey" | "contextWindow">
): Codex {
  const env = codexEnv(options.codexHome);
  const codexOptions: CodexOptions = {
    ...(options.codexBin ? { codexPathOverride: options.codexBin } : {}),
    env
  };

  if (settings.provider === "openai_compatible") {
    if (!settings.baseUrl || !settings.contextWindow) {
      throw new Error("OpenAI compatible provider settings are incomplete");
    }
    env[COMPATIBLE_API_KEY_ENV] = settings.apiKey || COMPATIBLE_DUMMY_API_KEY;
    codexOptions.config = {
      model_provider: COMPATIBLE_PROVIDER_ID,
      model_context_window: settings.contextWindow,
      model_providers: {
        [COMPATIBLE_PROVIDER_ID]: {
          name: "OpenAI Compatible",
          base_url: settings.baseUrl,
          env_key: COMPATIBLE_API_KEY_ENV,
          wire_api: "responses"
        }
      }
    };
  }

  return new Codex(codexOptions);
}

function codexEnv(codexHome?: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  if (codexHome) env.CODEX_HOME = codexHome;
  return env;
}
