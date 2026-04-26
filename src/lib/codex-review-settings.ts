import type { Db } from "./prisma";
import { nowIso } from "./prisma";
import type { UserRole } from "./roles";

export const DEFAULT_CODEX_REVIEW_MODEL = "gpt-5.5";
export const DEFAULT_CODEX_REVIEW_REASONING_EFFORT = "xhigh";
export const CODEX_REVIEW_MODEL_PRESETS = ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini", "gpt-5.3-codex"] as const;
export const CODEX_REVIEW_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;

export type CodexReviewReasoningEffort = (typeof CODEX_REVIEW_REASONING_EFFORTS)[number];

export type CodexReviewRuntimeSettings = {
  model: string;
  reasoningEffort: CodexReviewReasoningEffort;
};

export type CodexReviewSettingsView = CodexReviewRuntimeSettings & {
  isDefault: boolean;
  updatedByUserId: number | null;
  updatedAt: string | null;
  defaults: CodexReviewRuntimeSettings;
  modelPresets: string[];
  reasoningEfforts: CodexReviewReasoningEffort[];
};

export class CodexReviewSettingsError extends Error {}
export class CodexReviewSettingsPermissionError extends Error {}

export class CodexReviewSettingsService {
  constructor(private readonly db: Db) {}

  async getEffectiveReviewSettings(): Promise<CodexReviewSettingsView> {
    const row = await this.db.codexReviewSettings.findUnique({ where: { id: 1 } });
    if (!row) return settingsView(defaultRuntimeSettings(), true, null, null);
    return settingsView(
      {
        model: row.model,
        reasoningEffort: parseReasoningEffort(row.reasoningEffort)
      },
      false,
      row.updatedByUserId,
      row.updatedAt
    );
  }

  async updateReviewSettings(
    user: { id: number; role: UserRole },
    input: { model: string; reasoningEffort: string }
  ): Promise<CodexReviewSettingsView> {
    if (user.role !== "admin") {
      throw new CodexReviewSettingsPermissionError("Admin role required");
    }

    const settings = validateReviewSettings(input);
    const timestamp = nowIso();
    const row = await this.db.codexReviewSettings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        updatedByUserId: user.id,
        createdAt: timestamp,
        updatedAt: timestamp
      },
      update: {
        model: settings.model,
        reasoningEffort: settings.reasoningEffort,
        updatedByUserId: user.id,
        updatedAt: timestamp
      }
    });

    return settingsView(
      { model: row.model, reasoningEffort: parseReasoningEffort(row.reasoningEffort) },
      false,
      row.updatedByUserId,
      row.updatedAt
    );
  }
}

export function defaultRuntimeSettings(): CodexReviewRuntimeSettings {
  return {
    model: DEFAULT_CODEX_REVIEW_MODEL,
    reasoningEffort: DEFAULT_CODEX_REVIEW_REASONING_EFFORT
  };
}

export function validateReviewSettings(input: { model: string; reasoningEffort: string }): CodexReviewRuntimeSettings {
  const model = input.model.trim();
  if (!model || /\s/.test(model)) {
    throw new CodexReviewSettingsError("Model must be a non-empty value without whitespace");
  }
  return {
    model,
    reasoningEffort: parseReasoningEffort(input.reasoningEffort)
  };
}

function parseReasoningEffort(value: string): CodexReviewReasoningEffort {
  if (CODEX_REVIEW_REASONING_EFFORTS.includes(value as CodexReviewReasoningEffort)) {
    return value as CodexReviewReasoningEffort;
  }
  throw new CodexReviewSettingsError("Invalid reasoning effort");
}

function settingsView(
  settings: CodexReviewRuntimeSettings,
  isDefault: boolean,
  updatedByUserId: number | null,
  updatedAt: string | null
): CodexReviewSettingsView {
  return {
    ...settings,
    isDefault,
    updatedByUserId,
    updatedAt,
    defaults: defaultRuntimeSettings(),
    modelPresets: [...CODEX_REVIEW_MODEL_PRESETS],
    reasoningEfforts: [...CODEX_REVIEW_REASONING_EFFORTS]
  };
}
