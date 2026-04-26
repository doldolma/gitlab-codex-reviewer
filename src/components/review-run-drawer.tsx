"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { apiGet, type MergeRequest, type ReviewEvent } from "../lib/api-client";
import { ReviewEventTimeline, ReviewProgressSummary } from "./review-event-timeline";

export function ReviewRunDrawer({ mergeRequest, onClose }: { mergeRequest: MergeRequest | null; onClose: () => void }) {
  const events = useQuery({
    queryKey: ["review-events", "mr", mergeRequest?.reviewRunId],
    queryFn: () => apiGet<{ events: ReviewEvent[] }>(`/api/reviews/${mergeRequest!.reviewRunId}/events`),
    enabled: Boolean(mergeRequest?.reviewRunId),
    refetchInterval: isActiveStatus(mergeRequest?.reviewStatus ?? null) ? 1000 : false
  });

  if (!mergeRequest) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">리뷰 실행</span>
            <h2>!{mergeRequest.mrIid} {mergeRequest.title}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="닫기">
            <X size={18} />
          </button>
        </header>
        <dl className="detail-list">
          <dt>프로젝트</dt>
          <dd>{mergeRequest.projectName}</dd>
          <dt>Head SHA</dt>
          <dd className="mono">{mergeRequest.headSha ?? "대기 중"}</dd>
          <dt>상태</dt>
          <dd>{labelForStatus(mergeRequest.reviewStatus)}</dd>
          <dt>관측 시간</dt>
          <dd>{new Date(mergeRequest.observedAt).toLocaleString()}</dd>
          <dt>마지막 리뷰</dt>
          <dd>{mergeRequest.reviewedAt ? new Date(mergeRequest.reviewedAt).toLocaleString() : "아직 없음"}</dd>
        </dl>
        <ReviewProgressSummary events={events.data?.events ?? []} status={mergeRequest.reviewStatus} />
        {mergeRequest.errorMessage && (
          <pre className="error-box">{mergeRequest.errorMessage}</pre>
        )}
        {mergeRequest.reviewStatus === "no_findings" && (
          <div className="alert neutral">액션이 필요한 이슈는 없으며, 리뷰 요약 댓글을 GitLab에 남겼습니다.</div>
        )}
        {mergeRequest.findingsMarkdown && (
          <section className="drawer-section">
            <h3>리뷰 요약</h3>
            <pre className="markdown-box">{mergeRequest.findingsMarkdown}</pre>
          </section>
        )}
        <section className="drawer-section">
          <h3>실행 기록</h3>
          <ReviewEventTimeline events={events.data?.events ?? []} isLoading={events.isLoading} />
        </section>
        <div className="button-row">
          <a className="button secondary full" href={mergeRequest.webUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            GitLab에서 열기
          </a>
          {mergeRequest.commentUrl && (
            <a className="button secondary full" href={mergeRequest.commentUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              댓글 열기
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}

function labelForStatus(status: string | null): string {
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

function isActiveStatus(status: string | null): boolean {
  return status === "queued" || status === "running";
}
