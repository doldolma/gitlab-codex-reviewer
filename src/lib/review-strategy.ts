import type { CodexReviewReasoningEffort } from "./codex-review-settings";

export const REVIEW_STRATEGIES = ["auto", "fast", "balanced", "thorough"] as const;
export type ReviewStrategy = (typeof REVIEW_STRATEGIES)[number];
export type ReviewRiskLevel = "low" | "medium" | "high";

export type ReviewStrategyResolution = {
  configuredStrategy: ReviewStrategy;
  effectiveReasoningEffort: CodexReviewReasoningEffort;
  triageUsed: boolean;
  triageRiskLevel: ReviewRiskLevel | null;
  triageReason: string | null;
  triageRiskSignals: string[];
};

export function parseReviewStrategy(value: string | null | undefined): ReviewStrategy {
  if (REVIEW_STRATEGIES.includes(value as ReviewStrategy)) return value as ReviewStrategy;
  return "auto";
}

export function fixedReasoningForStrategy(strategy: Exclude<ReviewStrategy, "auto">): CodexReviewReasoningEffort {
  switch (strategy) {
    case "fast":
      return "medium";
    case "balanced":
      return "high";
    case "thorough":
      return "xhigh";
  }
}

export function resolveFixedReviewStrategy(strategy: Exclude<ReviewStrategy, "auto">): ReviewStrategyResolution {
  return {
    configuredStrategy: strategy,
    effectiveReasoningEffort: fixedReasoningForStrategy(strategy),
    triageUsed: false,
    triageRiskLevel: null,
    triageReason: null,
    triageRiskSignals: []
  };
}

export function strategyLabel(strategy: ReviewStrategy): string {
  switch (strategy) {
    case "auto":
      return "Auto";
    case "fast":
      return "빠름";
    case "balanced":
      return "균형";
    case "thorough":
      return "정밀";
  }
}
