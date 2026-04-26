import { ExternalLink, RotateCcw } from "lucide-react";
import type { MergeRequest } from "../lib/api-client";
import { ReviewMetaSummary } from "./review-meta-summary";

export function MrReviewTable({
  mergeRequests,
  onRetry,
  onSelect
}: {
  mergeRequests: MergeRequest[];
  onRetry: (runId: number) => void;
  onSelect: (mr: MergeRequest) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Merge Request</th>
            <th>프로젝트</th>
            <th>Head SHA</th>
            <th>리뷰</th>
            <th>Codex</th>
            <th>마지막 리뷰</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {mergeRequests.map((mr) => (
            <tr key={mr.id} onClick={() => onSelect(mr)} className="clickable">
              <td>
                <strong>!{mr.mrIid} {mr.title}</strong>
                <span className="subtle">{mr.authorUsername ?? "unknown"}</span>
              </td>
              <td>{mr.projectName}</td>
              <td className="mono">{mr.headSha ? mr.headSha.slice(0, 10) : "pending"}</td>
              <td>
                <span className={`status ${statusClass(mr.reviewStatus)}`}>{labelForStatus(mr.reviewStatus)}</span>
              </td>
              <td>
                <ReviewMetaSummary meta={mr.reviewMeta} />
              </td>
              <td>{mr.reviewedAt ? new Date(mr.reviewedAt).toLocaleString() : "아직 없음"}</td>
              <td className="right" onClick={(event) => event.stopPropagation()}>
                <div className="button-row end">
                  {mr.commentUrl && (
                    <a className="icon-button" href={mr.commentUrl} target="_blank" rel="noreferrer" title="리뷰 댓글 열기">
                      <ExternalLink size={16} />
                    </a>
                  )}
                  {mr.reviewRunId && mr.reviewStatus === "failed" && (
                    <button className="icon-button" onClick={() => onRetry(mr.reviewRunId!)} title="리뷰 재시도">
                      <RotateCcw size={16} />
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
          {!mergeRequests.length && (
            <tr>
              <td colSpan={7} className="empty">
                관측된 Merge Request가 없습니다
              </td>
            </tr>
          )}
        </tbody>
      </table>
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

function statusClass(status: string | null): string {
  switch (status) {
    case "queued":
    case "running":
      return "warn";
    case "commented":
      return "ok";
    case "no_findings":
      return "muted";
    case "failed":
      return "bad";
    default:
      return "muted";
  }
}
