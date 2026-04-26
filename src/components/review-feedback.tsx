"use client";

import { useMutation } from "@tanstack/react-query";
import { apiSend, type ReviewFeedbackRating, type StructuredReview, type StructuredReviewIssue } from "../lib/api-client";

export function ReviewFeedbackPanel({
  runType,
  runId,
  review
}: {
  runType: "mr" | "commit";
  runId: number | null;
  review: StructuredReview | null;
}) {
  const issues = [...(review?.criticalIssues ?? []), ...(review?.potentialIssues ?? [])];
  const feedback = useMutation({
    mutationFn: (payload: { fingerprint: string; rating: ReviewFeedbackRating }) =>
      apiSend(runType === "mr" ? `/api/reviews/${runId}/feedback` : `/api/commit-reviews/${runId}/feedback`, {
        method: "POST",
        body: JSON.stringify({ issueFingerprint: payload.fingerprint, rating: payload.rating })
      })
  });

  if (!runId || !issues.length) return null;

  return (
    <section className="drawer-section">
      <h3>리뷰 피드백</h3>
      <div className="feedback-list">
        {issues.map((issue) => {
          const fingerprint = issueFingerprint(issue);
          return (
            <div className="feedback-card" key={fingerprint}>
              <strong>{issue.title}</strong>
              <small>{issue.file ? `${issue.file}${issue.line ? `:${issue.line}` : ""}` : "위치 없음"}</small>
              <div className="button-row wrap">
                <FeedbackButton label="유용함" rating="helpful" fingerprint={fingerprint} mutate={feedback.mutate} pending={feedback.isPending} />
                <FeedbackButton label="오탐" rating="false_positive" fingerprint={fingerprint} mutate={feedback.mutate} pending={feedback.isPending} />
                <FeedbackButton label="너무 사소함" rating="too_minor" fingerprint={fingerprint} mutate={feedback.mutate} pending={feedback.isPending} />
                <FeedbackButton label="놓친 이슈 있음" rating="missed_issue" fingerprint={fingerprint} mutate={feedback.mutate} pending={feedback.isPending} />
              </div>
            </div>
          );
        })}
      </div>
      {feedback.isSuccess && <div className="alert neutral">피드백을 저장했습니다.</div>}
      {feedback.error && <div className="alert error">{feedback.error.message}</div>}
    </section>
  );
}

function FeedbackButton({
  label,
  rating,
  fingerprint,
  mutate,
  pending
}: {
  label: string;
  rating: ReviewFeedbackRating;
  fingerprint: string;
  mutate: (payload: { fingerprint: string; rating: ReviewFeedbackRating }) => void;
  pending: boolean;
}) {
  return (
    <button className="button secondary small" type="button" disabled={pending} onClick={() => mutate({ fingerprint, rating })}>
      {label}
    </button>
  );
}

function issueFingerprint(issue: StructuredReviewIssue): string {
  return [issue.category, issue.severity, issue.file ?? "", issue.line ?? "", issue.title].join(":").slice(0, 300);
}
