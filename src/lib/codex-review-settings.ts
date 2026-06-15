import type { Db } from "./prisma";
import { nowIso } from "./prisma";
import type { UserRole } from "./roles";
import type { SecretStore } from "./secret-store";
import type { OpenAICompatibleVerifier } from "./openai-compatible-verifier";

export const DEFAULT_CODEX_REVIEW_MODEL = "gpt-5.5";
export const DEFAULT_CODEX_REVIEW_REASONING_EFFORT = "high";
export const DEFAULT_COMPATIBLE_CONTEXT_WINDOW = 131_072;
export const TRIAGE_CODEX_REVIEW_REASONING_EFFORT = "medium";
export const CODEX_REVIEW_MODEL_PRESETS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"] as const;
export const CODEX_REVIEW_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
export const AI_REVIEW_PROVIDERS = ["codex", "openai_compatible"] as const;

export type AiReviewProvider = (typeof AI_REVIEW_PROVIDERS)[number];
export type CodexReviewReasoningEffort = (typeof CODEX_REVIEW_REASONING_EFFORTS)[number];

type ProviderRuntimeBase = {
  provider: AiReviewProvider;
  providerLabel: string;
  model: string;
};

export type CodexReviewModelSettings =
  | (ProviderRuntimeBase & {
      provider: "codex";
      baseUrl?: never;
      apiKey?: never;
      contextWindow?: never;
    })
  | (ProviderRuntimeBase & {
      provider: "openai_compatible";
      baseUrl: string;
      apiKey: string | null;
      contextWindow: number;
    });

export type CodexReviewRuntimeSettings = CodexReviewModelSettings & {
  reasoningEffort: CodexReviewReasoningEffort;
};

export type CompatibleProviderView = {
  baseUrl: string | null;
  model: string | null;
  contextWindow: number | null;
  apiKeyConfigured: boolean;
  lastVerifiedAt: string | null;
};

export type CodexReviewSettingsView = {
  provider: AiReviewProvider;
  providerLabel: string;
  model: string;
  codexModel: string;
  compatible: CompatibleProviderView;
  isDefault: boolean;
  updatedByUserId: number | null;
  updatedAt: string | null;
  defaults: {
    provider: "codex";
    codexModel: string;
    compatibleContextWindow: number;
  };
  modelPresets: string[];
  strategyMode: "project";
};

export type CodexSettingsUpdate = {
  provider: "codex";
  model: string;
};

export type CompatibleSettingsUpdate = {
  provider: "openai_compatible";
  baseUrl: string;
  model: string;
  contextWindow: number;
  apiKey?: string;
  clearApiKey?: boolean;
};

export type AiReviewSettingsUpdate = CodexSettingsUpdate | CompatibleSettingsUpdate;

export class CodexReviewSettingsError extends Error {}
export class CodexReviewSettingsPermissionError extends Error {}

export class CodexReviewSettingsService {
  constructor(
    private readonly db: Db,
    private readonly secrets?: SecretStore,
    private readonly compatibleVerifier?: OpenAICompatibleVerifier
  ) {}

  async getEffectiveReviewSettings(includeAdminDetails = false): Promise<CodexReviewSettingsView> {
    const row = await this.db.codexReviewSettings.findUnique({ where: { id: 1 } });
    if (!row) return settingsView(null, includeAdminDetails);
    return settingsView(row, includeAdminDetails);
  }

  async getEffectiveRuntimeSettings(): Promise<CodexReviewModelSettings> {
    const row = await this.db.codexReviewSettings.findUnique({ where: { id: 1 } });
    if (!row || parseProvider(row.provider) === "codex") {
      return codexModelSettings(row?.model ?? DEFAULT_CODEX_REVIEW_MODEL);
    }
    if (!row.compatibleBaseUrl || !row.compatibleModel) {
      throw new CodexReviewSettingsError("OpenAI compatible provider settings are incomplete");
    }
    return compatibleModelSettings({
      baseUrl: row.compatibleBaseUrl,
      model: row.compatibleModel,
      contextWindow: row.compatibleContextWindow,
      apiKey: decryptOptional(this.secrets, row.compatibleApiKeyEncrypted)
    });
  }

  async updateReviewSettings(
    user: { id: number; role: UserRole },
    input: AiReviewSettingsUpdate
  ): Promise<CodexReviewSettingsView> {
    if (user.role !== "admin") {
      throw new CodexReviewSettingsPermissionError("Admin role required");
    }

    if (input.provider === "codex") {
      return this.updateCodexSettings(user.id, input);
    }
    return this.verifyAndUpdateCompatibleSettings(user.id, input);
  }

  private async updateCodexSettings(userId: number, input: CodexSettingsUpdate): Promise<CodexReviewSettingsView> {
    const model = validateModel(input.model);
    const timestamp = nowIso();
    const row = await this.db.codexReviewSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        model,
        reasoningEffort: DEFAULT_CODEX_REVIEW_REASONING_EFFORT,
        provider: "codex",
        updatedByUserId: userId,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      update: {
        provider: "codex",
        model,
        updatedByUserId: userId,
        updatedAt: timestamp
      }
    });
    return settingsView(row, true);
  }

  private async verifyAndUpdateCompatibleSettings(
    userId: number,
    input: CompatibleSettingsUpdate
  ): Promise<CodexReviewSettingsView> {
    if (!this.secrets || !this.compatibleVerifier) {
      throw new CodexReviewSettingsError("OpenAI compatible provider verification is not configured");
    }
    if (input.apiKey?.trim() && input.clearApiKey) {
      throw new CodexReviewSettingsError("API key cannot be set and cleared at the same time");
    }

    const current = await this.db.codexReviewSettings.findUnique({ where: { id: 1 } });
    const baseUrl = normalizeCompatibleBaseUrl(input.baseUrl);
    const model = validateModel(input.model);
    const contextWindow = validateContextWindow(input.contextWindow);
    const apiKey = input.clearApiKey
      ? null
      : input.apiKey?.trim() || decryptOptional(this.secrets, current?.compatibleApiKeyEncrypted ?? null);
    const runtime = compatibleModelSettings({ baseUrl, model, contextWindow, apiKey });

    try {
      await this.compatibleVerifier.verify(runtime);
    } catch (error) {
      throw new CodexReviewSettingsError(`OpenAI compatible provider verification failed: ${errorMessage(error)}`);
    }

    const timestamp = nowIso();
    const encryptedApiKey = apiKey ? this.secrets.encrypt(apiKey) : null;
    const row = await this.db.codexReviewSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        model: DEFAULT_CODEX_REVIEW_MODEL,
        reasoningEffort: DEFAULT_CODEX_REVIEW_REASONING_EFFORT,
        provider: "openai_compatible",
        compatibleBaseUrl: baseUrl,
        compatibleModel: model,
        compatibleContextWindow: contextWindow,
        compatibleApiKeyEncrypted: encryptedApiKey,
        compatibleLastVerifiedAt: timestamp,
        updatedByUserId: userId,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      update: {
        provider: "openai_compatible",
        compatibleBaseUrl: baseUrl,
        compatibleModel: model,
        compatibleContextWindow: contextWindow,
        compatibleApiKeyEncrypted: encryptedApiKey,
        compatibleLastVerifiedAt: timestamp,
        updatedByUserId: userId,
        updatedAt: timestamp
      }
    });
    return settingsView(row, true);
  }
}

export function defaultRuntimeSettings(): CodexReviewRuntimeSettings {
  return runtimeSettings(codexModelSettings(DEFAULT_CODEX_REVIEW_MODEL), DEFAULT_CODEX_REVIEW_REASONING_EFFORT);
}

export function defaultModelSettings(): CodexReviewModelSettings {
  return codexModelSettings(DEFAULT_CODEX_REVIEW_MODEL);
}

export function runtimeSettings(
  settings: CodexReviewModelSettings,
  reasoningEffort: CodexReviewReasoningEffort
): CodexReviewRuntimeSettings {
  return { ...settings, reasoningEffort };
}

export function validateReviewSettings(input: { model: string }): { model: string } {
  return { model: validateModel(input.model) };
}

export function parseReasoningEffort(value: string): CodexReviewReasoningEffort {
  if (CODEX_REVIEW_REASONING_EFFORTS.includes(value as CodexReviewReasoningEffort)) {
    return value as CodexReviewReasoningEffort;
  }
  throw new CodexReviewSettingsError("Invalid reasoning effort");
}

export function providerLabel(provider: AiReviewProvider): string {
  return provider === "codex" ? "Codex 계정" : "OpenAI 호환 API";
}

function codexModelSettings(model: string): CodexReviewModelSettings {
  return { provider: "codex", providerLabel: providerLabel("codex"), model };
}

function compatibleModelSettings(input: {
  baseUrl: string;
  model: string;
  contextWindow: number;
  apiKey: string | null;
}): CodexReviewModelSettings {
  return {
    provider: "openai_compatible",
    providerLabel: providerLabel("openai_compatible"),
    ...input
  };
}

function settingsView(
  row: {
    provider: string;
    model: string;
    compatibleBaseUrl: string | null;
    compatibleModel: string | null;
    compatibleContextWindow: number;
    compatibleApiKeyEncrypted: string | null;
    compatibleLastVerifiedAt: string | null;
    updatedByUserId: number | null;
    updatedAt: string;
  } | null,
  includeAdminDetails: boolean
): CodexReviewSettingsView {
  const provider = parseProvider(row?.provider ?? "codex");
  const codexModel = row?.model ?? DEFAULT_CODEX_REVIEW_MODEL;
  const compatibleModel = row?.compatibleModel ?? null;
  return {
    provider,
    providerLabel: providerLabel(provider),
    model: provider === "openai_compatible" ? compatibleModel ?? "설정 필요" : codexModel,
    codexModel,
    compatible: {
      baseUrl: includeAdminDetails ? row?.compatibleBaseUrl ?? null : null,
      model: includeAdminDetails ? compatibleModel : null,
      contextWindow: includeAdminDetails ? row?.compatibleContextWindow ?? DEFAULT_COMPATIBLE_CONTEXT_WINDOW : null,
      apiKeyConfigured: includeAdminDetails && Boolean(row?.compatibleApiKeyEncrypted),
      lastVerifiedAt: row?.compatibleLastVerifiedAt ?? null
    },
    isDefault: !row,
    updatedByUserId: row?.updatedByUserId ?? null,
    updatedAt: row?.updatedAt ?? null,
    defaults: {
      provider: "codex",
      codexModel: DEFAULT_CODEX_REVIEW_MODEL,
      compatibleContextWindow: DEFAULT_COMPATIBLE_CONTEXT_WINDOW
    },
    modelPresets: [...CODEX_REVIEW_MODEL_PRESETS],
    strategyMode: "project"
  };
}

function parseProvider(value: string): AiReviewProvider {
  if (value === "openai_compatible") return value;
  return "codex";
}

function validateModel(value: string): string {
  const model = value.trim();
  if (!model || /\s/.test(model)) {
    throw new CodexReviewSettingsError("Model must be a non-empty value without whitespace");
  }
  return model;
}

function normalizeCompatibleBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new CodexReviewSettingsError("OpenAI compatible Base URL must be a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new CodexReviewSettingsError("OpenAI compatible Base URL must use http or https");
  }
  return url.pathname.replace(/\/+$/, "").endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function validateContextWindow(value: number): number {
  if (!Number.isInteger(value) || value < 8_192 || value > 2_000_000) {
    throw new CodexReviewSettingsError("Context window must be an integer between 8192 and 2000000");
  }
  return value;
}

function decryptOptional(secrets: SecretStore | undefined, encrypted: string | null): string | null {
  if (!encrypted) return null;
  if (!secrets) throw new CodexReviewSettingsError("Secret store is required to load the OpenAI compatible API key");
  return secrets.decrypt(encrypted);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
