import type { ReviewMeta } from "../lib/api-client";

export function ReviewMetaSummary({ meta }: { meta: ReviewMeta | null }) {
  if (!meta || !hasReviewMeta(meta)) {
    return <span className="subtle">-</span>;
  }

  return (
    <div className="review-meta-summary">
      {(meta.model || meta.reasoningEffort) && (
        <span>
          {meta.providerLabel ? `${meta.providerLabel} · ` : ""}
          {meta.model ?? "AI"}
          {meta.reviewStrategy ? ` · ${strategyExecutionLabel(meta.reviewStrategy, meta.reasoningEffort)}` : meta.reasoningEffort ? ` · ${meta.reasoningEffort}` : ""}
        </span>
      )}
      {meta.totalTokens !== null && <span>토큰 {formatCompactNumber(meta.totalTokens)}</span>}
      {meta.reasoningTokens !== null && <span>reasoning {formatCompactNumber(meta.reasoningTokens)}</span>}
    </div>
  );
}

function hasReviewMeta(meta: ReviewMeta): boolean {
  return Boolean(
    meta.provider ||
      meta.providerLabel ||
      meta.model ||
      meta.reasoningEffort ||
      meta.promptVersion ||
      meta.reviewStrategy ||
      meta.triageUsed !== null ||
      meta.triageRiskLevel ||
      meta.triageReason ||
      meta.inputTokens !== null ||
      meta.outputTokens !== null ||
      meta.reasoningTokens !== null ||
      meta.totalTokens !== null
  );
}

function strategyExecutionLabel(strategy: string, effort: string | null): string {
  if (!effort) return strategy;
  if (strategy === "auto") return `auto → ${effort}`;
  return `${strategy} → ${effort}`;
}

function formatCompactNumber(value: number): string {
  if (value < 1000) return value.toLocaleString();
  if (value < 1_000_000) return `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return `${(value / 1_000_000).toFixed(1)}m`;
}
