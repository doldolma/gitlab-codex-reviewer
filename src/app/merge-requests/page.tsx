"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { MrReviewTable } from "../../components/mr-review-table";
import { ReviewRunDrawer } from "../../components/review-run-drawer";
import { apiGet, apiSend, type MergeRequest, type ReviewJob } from "../../lib/api-client";

export default function MergeRequestsPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<MergeRequest | null>(null);
  const mergeRequests = useQuery({
    queryKey: ["merge-requests"],
    queryFn: () => apiGet<{ mergeRequests: MergeRequest[] }>("/api/merge-requests"),
    refetchInterval: (query) => (hasActiveMergeRequests(query.state.data?.mergeRequests ?? []) ? 1000 : false)
  });
  const mergeRequestRows = mergeRequests.data?.mergeRequests ?? [];
  const selectedMergeRequest = selected ? mergeRequestRows.find((mr) => mr.id === selected.id) ?? selected : null;
  const activeCount = mergeRequestRows.filter((mr) => isActiveStatus(mr.reviewStatus)).length;

  const scan = useMutation({
    mutationFn: () => apiSend<{ queued: boolean; job: ReviewJob }>("/api/reviews/scan", { method: "POST" }),
    onSuccess: () => {
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
            onSelect={setSelected}
          />
        </section>
        <ReviewRunDrawer mergeRequest={selectedMergeRequest} onClose={() => setSelected(null)} />
      </div>
    </AppShell>
  );
}

function isActiveStatus(status: string | null): boolean {
  return status === "queued" || status === "running";
}

function hasActiveMergeRequests(mergeRequests: MergeRequest[]): boolean {
  return mergeRequests.some((mr) => isActiveStatus(mr.reviewStatus));
}
