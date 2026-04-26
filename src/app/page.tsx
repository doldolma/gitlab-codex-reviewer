"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Play, RefreshCw } from "lucide-react";
import { AppShell } from "../components/app-shell";
import { AuthStatusPanel } from "../components/auth-status";
import { MrReviewTable } from "../components/mr-review-table";
import { apiGet, apiSend, type Dashboard, type ReviewJob } from "../lib/api-client";

export default function DashboardPage() {
  const queryClient = useQueryClient();
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<Dashboard>("/api/dashboard"),
    refetchInterval: (query) => ((query.state.data?.stats.runningCount ?? 0) > 0 ? 1000 : false)
  });
  const scan = useMutation({
    mutationFn: () => apiSend<{ queued: boolean; job: ReviewJob }>("/api/reviews/scan", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      void queryClient.invalidateQueries({ queryKey: ["merge-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["commit-reviews"] });
    }
  });

  return (
    <AppShell>
      <div className="page">
        <header className="page-header">
          <div>
            <span className="eyebrow">개요</span>
            <h1>리뷰 대시보드</h1>
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={() => dashboard.refetch()}>
              <RefreshCw size={16} />
              새로고침
            </button>
            <button className="button" onClick={() => scan.mutate()} disabled={scan.isPending}>
              <Play size={16} />
              스캔 시작
            </button>
          </div>
        </header>

        <AuthStatusPanel />

        <section className="metric-grid">
          <Metric label="프로젝트" value={dashboard.data?.stats.projectCount ?? 0} />
          <Metric label="Opened MR" value={dashboard.data?.stats.mrCount ?? 0} />
          <Metric label="진행 중" value={dashboard.data?.stats.runningCount ?? 0} />
          <Metric label="실패" value={dashboard.data?.stats.failedCount ?? 0} />
          <Metric label="댓글 작성됨" value={dashboard.data?.stats.commentedCount ?? 0} />
        </section>

        <section className="panel">
          <div className="section-heading">
            <h2>최근 Merge Request</h2>
          </div>
          <MrReviewTable mergeRequests={dashboard.data?.recentMergeRequests ?? []} onRetry={() => undefined} onSelect={() => undefined} />
        </section>
      </div>
    </AppShell>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
