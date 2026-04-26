"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { apiGet, type CommitReview, type ReviewEvent } from "../lib/api-client";
import { ReviewEventTimeline, ReviewProgressSummary } from "./review-event-timeline";

export function CommitReviewDrawer({ review, onClose }: { review: CommitReview | null; onClose: () => void }) {
  const events = useQuery({
    queryKey: ["review-events", "commit", review?.id],
    queryFn: () => apiGet<{ events: ReviewEvent[] }>(`/api/commit-reviews/${review!.id}/events`),
    enabled: Boolean(review?.id),
    refetchInterval: isActiveStatus(review?.status ?? null) ? 1000 : false
  });

  if (!review) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">커밋 리뷰</span>
            <h2>{review.commitTitle || review.commitSha.slice(0, 12)}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="닫기">
            <X size={18} />
          </button>
        </header>
        <dl className="detail-list">
          <dt>프로젝트</dt>
          <dd>{review.projectName}</dd>
          <dt>Commit SHA</dt>
          <dd className="mono">{review.commitSha}</dd>
          <dt>브랜치</dt>
          <dd>{review.branchName ?? "수동"}</dd>
          <dt>실행 방식</dt>
          <dd>{labelForTrigger(review.trigger)}</dd>
          <dt>상태</dt>
          <dd>{labelForStatus(review.status)}</dd>
          <dt>리뷰 완료</dt>
          <dd>{review.finishedAt ? new Date(review.finishedAt).toLocaleString() : "아직 없음"}</dd>
        </dl>
        <ReviewProgressSummary events={events.data?.events ?? []} status={review.status} />
        {review.errorMessage && <pre className="error-box">{review.errorMessage}</pre>}
        {review.status === "no_findings" && (
          <div className="alert neutral">액션이 필요한 이슈는 없으며, 리뷰 요약 댓글을 GitLab에 남겼습니다.</div>
        )}
        {review.findingsMarkdown && (
          <section className="drawer-section">
            <h3>리뷰 요약</h3>
            <pre className="markdown-box">{review.findingsMarkdown}</pre>
          </section>
        )}
        <section className="drawer-section">
          <h3>실행 기록</h3>
          <ReviewEventTimeline events={events.data?.events ?? []} isLoading={events.isLoading} />
        </section>
        <div className="button-row">
          {review.commitUrl && (
            <a className="button secondary full" href={review.commitUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              커밋 열기
            </a>
          )}
          {review.commentUrl && (
            <a className="button secondary full" href={review.commentUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              댓글 열기
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}

function labelForStatus(status: string): string {
  switch (status) {
    case "queued":
      return "대기 중";
    case "running":
      return "리뷰 중";
    case "commented":
      return "댓글 작성됨";
    case "no_findings":
      return "완료: 이슈 없음";
    case "failed":
      return "실패";
    default:
      return "대기";
  }
}

function labelForTrigger(trigger: string): string {
  if (trigger === "manual") return "수동";
  if (trigger === "auto") return "자동";
  return trigger;
}

function isActiveStatus(status: string | null): boolean {
  return status === "queued" || status === "running";
}
