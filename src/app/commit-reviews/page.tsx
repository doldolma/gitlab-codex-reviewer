"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Play, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { CommitReviewDrawer } from "../../components/commit-review-drawer";
import { BranchCombobox, CommitCombobox, GitLabProjectCombobox } from "../../components/gitlab-combobox";
import { PaginationControls } from "../../components/pagination-controls";
import { ReviewMetaSummary } from "../../components/review-meta-summary";
import { apiGet, apiSend, type CommitReview, type CommitReviewListResponse, type PaginationInfo, type ReviewJob, type ReviewStrategy } from "../../lib/api-client";
import { commitReviewExternalLink } from "../../lib/review-links";

const COMMIT_REVIEW_PAGE_SIZE = 20;

export default function CommitReviewsPage() {
  const queryClient = useQueryClient();
  const [gitlabProjectId, setGitlabProjectId] = useState("");
  const [commitSha, setCommitSha] = useState("");
  const [branchName, setBranchName] = useState("");
  const [reviewStrategy, setReviewStrategy] = useState<ReviewStrategy>("auto");
  const [selected, setSelected] = useState<CommitReview | null>(null);
  const [page, setPage] = useState(1);

  const commitReviews = useQuery({
    queryKey: ["commit-reviews", page, COMMIT_REVIEW_PAGE_SIZE],
    queryFn: () => apiGet<CommitReviewListResponse>(`/api/commit-reviews?page=${page}&pageSize=${COMMIT_REVIEW_PAGE_SIZE}`),
    refetchInterval: (query) =>
      hasActiveReviews(query.state.data?.commitReviews ?? []) || (query.state.data?.activeCount ?? 0) > 0 ? 1000 : false
  });
  const reviews = commitReviews.data?.commitReviews ?? [];
  const pagination = commitReviews.data?.pagination ?? defaultPagination(page);
  const selectedReview = selected ? reviews.find((review) => review.id === selected.id) ?? selected : null;
  const activeCount = commitReviews.data?.activeCount ?? reviews.filter((review) => isActiveStatus(review.status)).length;

  useEffect(() => {
    const responsePage = commitReviews.data?.pagination.page;
    if (responsePage && responsePage !== page) setPage(responsePage);
  }, [commitReviews.data?.pagination.page, page]);

  const manualReview = useMutation({
    mutationFn: (payload: { gitlabProjectId: string; commitSha: string; branchName?: string; reviewStrategy: ReviewStrategy }) =>
      apiSend<{ commitReview: CommitReview; job: ReviewJob }>("/api/commit-reviews/review", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (result) => {
      setCommitSha("");
      setSelected(result.commitReview);
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ["commit-reviews"] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["commit-reviews"] });
    }
  });

  const retry = useMutation({
    mutationFn: (runId: number) => apiSend<{ commitReview: CommitReview; job: ReviewJob }>(`/api/commit-reviews/${runId}/retry`, { method: "POST" }),
    onSuccess: (result) => {
      setSelected(result.commitReview);
      void queryClient.invalidateQueries({ queryKey: ["commit-reviews"] });
      void queryClient.invalidateQueries({ queryKey: ["review-events"] });
    }
  });

  const cancel = useMutation({
    mutationFn: (runId: number) => apiSend<{ commitReview: CommitReview }>(`/api/commit-reviews/${runId}/cancel`, { method: "POST" }),
    onSuccess: (result) => {
      setSelected(result.commitReview);
      void queryClient.invalidateQueries({ queryKey: ["commit-reviews"] });
      void queryClient.invalidateQueries({ queryKey: ["review-events"] });
    }
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!gitlabProjectId.trim() || !branchName.trim() || !commitSha.trim()) return;
    manualReview.mutate({
      gitlabProjectId,
      commitSha,
      branchName: branchName || undefined,
      reviewStrategy
    });
  }

  return (
    <AppShell>
      <div className="page">
        <header className="page-header">
          <div>
            <span className="eyebrow">리뷰</span>
            <h1>Commit Reviews</h1>
            <p>브랜치와 커밋을 선택해 수동 리뷰를 실행하고, 자동 커밋 리뷰 결과를 확인합니다.</p>
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={() => commitReviews.refetch()}>
              <RefreshCw size={16} />
              새로고침
            </button>
          </div>
        </header>

        <section className="panel">
          <form className="project-form commit-review-form" onSubmit={submit}>
            <label>
              <span>GitLab 프로젝트</span>
              <GitLabProjectCombobox
                value={gitlabProjectId}
                onChange={(value) => {
                  setGitlabProjectId(value);
                  setBranchName("");
                  setCommitSha("");
                }}
                required
              />
            </label>
            <label>
              <span>브랜치</span>
              <BranchCombobox
                projectId={gitlabProjectId}
                value={branchName}
                onChange={(value) => {
                  setBranchName(value);
                  setCommitSha("");
                }}
                placeholder="브랜치를 먼저 선택"
              />
            </label>
            <label>
              <span>커밋</span>
              <CommitCombobox projectId={gitlabProjectId} branchName={branchName} value={commitSha} onChange={setCommitSha} />
            </label>
            <label>
              <span>리뷰 전략</span>
              <select value={reviewStrategy} onChange={(event) => setReviewStrategy(event.target.value as ReviewStrategy)}>
                <option value="auto">Auto</option>
                <option value="fast">빠름</option>
                <option value="balanced">균형</option>
                <option value="thorough">정밀</option>
              </select>
            </label>
            <button
              className="button form-submit"
              type="submit"
              disabled={manualReview.isPending || !gitlabProjectId.trim() || !branchName.trim() || !commitSha.trim()}
            >
              <Play size={16} />
              리뷰 시작
            </button>
          </form>
          {manualReview.isError && (
            <div className="alert bad">
              {manualReview.error instanceof Error ? manualReview.error.message : "커밋 리뷰에 실패했습니다"}
            </div>
          )}
        </section>

        {activeCount > 0 && (
          <section className="active-review-strip">
            <strong>{activeCount}</strong>
            <span>{activeCount === 1 ? "리뷰가 대기 중이거나 실행 중입니다" : "리뷰들이 대기 중이거나 실행 중입니다"}</span>
          </section>
        )}

        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>커밋</th>
                  <th>프로젝트</th>
                  <th>브랜치</th>
                  <th>실행 방식</th>
                  <th>상태</th>
                  <th>AI</th>
                  <th>리뷰 완료</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {reviews.map((review) => (
                  <CommitReviewRow
                    key={review.id}
                    review={review}
                    onSelect={setSelected}
                    onRetry={(runId) => retry.mutate(runId)}
                    onCancel={(runId) => cancel.mutate(runId)}
                    isCanceling={cancel.isPending}
                  />
                ))}
                {!reviews.length && (
                  <tr>
                    <td colSpan={8} className="empty">
                      {pagination.total > 0 ? "이 페이지에 표시할 커밋 리뷰가 없습니다" : "아직 커밋 리뷰가 없습니다"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <PaginationControls pagination={pagination} label="커밋 리뷰 페이지" itemLabel="커밋 리뷰" onPageChange={setPage} />
        </section>
        <CommitReviewDrawer
          review={selectedReview}
          onClose={() => setSelected(null)}
          onCancel={(runId) => cancel.mutate(runId)}
          isCanceling={cancel.isPending}
        />
      </div>
    </AppShell>
  );
}

function CommitReviewRow({
  review,
  onSelect,
  onRetry,
  onCancel,
  isCanceling
}: {
  review: CommitReview;
  onSelect: (review: CommitReview) => void;
  onRetry: (runId: number) => void;
  onCancel: (runId: number) => void;
  isCanceling: boolean;
}) {
  const externalLink = commitReviewExternalLink(review);

  return (
    <tr onClick={() => onSelect(review)} className="clickable">
      <td>
        <strong>{review.commitTitle || review.commitSha.slice(0, 10)}</strong>
        <span className="subtle mono">{review.commitSha.slice(0, 12)}</span>
      </td>
      <td>{review.projectName}</td>
      <td>{review.branchName ?? "수동"}</td>
      <td>{labelForTrigger(review.trigger)}</td>
      <td>
        <span className={`status ${statusClass(review.status)}`}>{labelForStatus(review.status)}</span>
      </td>
      <td>
        <ReviewMetaSummary meta={review.reviewMeta} />
      </td>
      <td>{review.finishedAt ? new Date(review.finishedAt).toLocaleString() : "아직 없음"}</td>
      <td className="right" onClick={(event) => event.stopPropagation()}>
        <div className="button-row end">
          {externalLink && (
            <a className="icon-button" href={externalLink.href} target="_blank" rel="noreferrer" title={externalLink.title}>
              <ExternalLink size={16} />
            </a>
          )}
          {review.status === "failed" && (
            <button className="icon-button" onClick={() => onRetry(review.id)} title="리뷰 재시도">
              <RotateCcw size={16} />
            </button>
          )}
          {isActiveStatus(review.status) && (
            <button className="icon-button" onClick={() => onCancel(review.id)} disabled={isCanceling} title="리뷰 취소">
              <XCircle size={16} />
            </button>
          )}
        </div>
      </td>
    </tr>
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
    case "canceled":
      return "취소됨";
    default:
      return "대기";
  }
}

function labelForTrigger(trigger: string): string {
  if (trigger === "manual") return "수동";
  if (trigger === "auto") return "자동";
  return trigger;
}

function statusClass(status: string): string {
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
    case "canceled":
      return "muted";
    default:
      return "muted";
  }
}

function isActiveStatus(status: string | null): boolean {
  return status === "queued" || status === "running";
}

function hasActiveReviews(reviews: CommitReview[]): boolean {
  return reviews.some((review) => isActiveStatus(review.status));
}

function defaultPagination(page: number): PaginationInfo {
  return {
    page,
    pageSize: COMMIT_REVIEW_PAGE_SIZE,
    total: 0,
    totalPages: 0,
    hasPrev: false,
    hasNext: false
  };
}
