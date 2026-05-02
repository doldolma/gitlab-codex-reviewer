"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { MrReviewTable } from "../../components/mr-review-table";
import { PaginationControls } from "../../components/pagination-controls";
import { ReviewRunDrawer } from "../../components/review-run-drawer";
import { apiGet, apiSend, type MergeRequest, type MergeRequestListResponse, type PaginationInfo, type ReviewJob } from "../../lib/api-client";

const MERGE_REQUEST_PAGE_SIZE = 20;

export default function MergeRequestsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MergeRequest | null>(null);
  const [page, setPage] = useState(1);
  const mergeRequests = useQuery({
    queryKey: ["merge-requests", page, MERGE_REQUEST_PAGE_SIZE],
    queryFn: () => apiGet<MergeRequestListResponse>(`/api/merge-requests?page=${page}&pageSize=${MERGE_REQUEST_PAGE_SIZE}`),
    refetchInterval: (query) =>
      hasActiveMergeRequests(query.state.data?.mergeRequests ?? []) || (query.state.data?.activeCount ?? 0) > 0 ? 1000 : false
  });
  const mergeRequestRows = mergeRequests.data?.mergeRequests ?? [];
  const pagination = mergeRequests.data?.pagination ?? defaultPagination(page);
  const selectedMergeRequest = selected ? mergeRequestRows.find((mr) => mr.id === selected.id) ?? selected : null;
  const activeCount = mergeRequests.data?.activeCount ?? mergeRequestRows.filter((mr) => isActiveStatus(mr.reviewStatus)).length;

  useEffect(() => {
    const responsePage = mergeRequests.data?.pagination.page;
    if (responsePage && responsePage !== page) setPage(responsePage);
  }, [mergeRequests.data?.pagination.page, page]);

  const scan = useMutation({
    mutationFn: () => apiSend<{ queued: boolean; job: ReviewJob }>("/api/reviews/scan", { method: "POST" }),
    onSuccess: () => {
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ["merge-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["commit-reviews"] });
    }
  });

  const retry = useMutation({
    mutationFn: (runId: number) => apiSend<{ job: ReviewJob }>(`/api/reviews/${runId}/retry`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["merge-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["review-events"] });
    }
  });

  const cancel = useMutation({
    mutationFn: (runId: number) => apiSend<{ reviewRun: unknown }>(`/api/reviews/${runId}/cancel`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["merge-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["review-events"] });
    }
  });

  return (
    <AppShell>
      <div className="page">
        <header className="page-header">
          <div>
            <span className="eyebrow">리뷰</span>
            <h1>Merge Requests</h1>
            <p>설정한 target branch로 들어오는 opened MR을 확인하고 리뷰 작업을 큐에 넣습니다.</p>
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={() => mergeRequests.refetch()}>
              <RefreshCw size={16} />
              새로고침
            </button>
            <button className="button" onClick={() => scan.mutate()} disabled={scan.isPending}>
              <Play size={16} />
              스캔 시작
            </button>
          </div>
        </header>
        {activeCount > 0 && (
          <section className="active-review-strip">
            <strong>{activeCount}</strong>
            <span>{activeCount === 1 ? "리뷰가 대기 중이거나 실행 중입니다" : "리뷰들이 대기 중이거나 실행 중입니다"}</span>
          </section>
        )}
        <section className="panel">
          <MrReviewTable
            mergeRequests={mergeRequestRows}
            onRetry={(runId) => retry.mutate(runId)}
            onCancel={(runId) => cancel.mutate(runId)}
            isCanceling={cancel.isPending}
            onSelect={setSelected}
            emptyMessage={pagination.total > 0 ? "이 페이지에 표시할 Merge Request가 없습니다" : "관측된 Merge Request가 없습니다"}
          />
          <PaginationControls pagination={pagination} label="Merge Request 페이지" itemLabel="Merge Request" onPageChange={setPage} />
        </section>
        <ReviewRunDrawer
          mergeRequest={selectedMergeRequest}
          onClose={() => setSelected(null)}
          onCancel={(runId) => cancel.mutate(runId)}
          isCanceling={cancel.isPending}
        />
      </div>
    </AppShell>
  );
}

function defaultPagination(page: number): PaginationInfo {
  return {
    page,
    pageSize: MERGE_REQUEST_PAGE_SIZE,
    total: 0,
    totalPages: 0,
    hasPrev: false,
    hasNext: false
  };
}

function isActiveStatus(status: string | null): boolean {
  return status === "queued" || status === "running";
}

function hasActiveMergeRequests(mergeRequests: MergeRequest[]): boolean {
  return mergeRequests.some((mr) => isActiveStatus(mr.reviewStatus));
}
