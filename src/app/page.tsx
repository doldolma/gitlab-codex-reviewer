"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { Plus, RefreshCw } from "lucide-react";
import { AppShell } from "../components/app-shell";
import { AuthStatusPanel } from "../components/auth-status";
import { MrReviewTable } from "../components/mr-review-table";
import { apiGet, type Dashboard } from "../lib/api-client";

export default function DashboardPage() {
  const dashboard = useQuery({
    queryKey: ["dashboard"],
    queryFn: () => apiGet<Dashboard>("/api/dashboard"),
    refetchInterval: (query) => ((query.state.data?.stats.runningCount ?? 0) > 0 ? 1000 : false)
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
            <Link className="button" href="/projects">
              <Plus size={16} />
              프로젝트 추가
            </Link>
          </div>
        </header>

        <AuthStatusPanel />

        <section className="metric-grid">
          <Metric label="프로젝트" value={dashboard.data?.stats.projectCount ?? 0} />
          <Metric label="Opened MR" value={dashboard.data?.stats.mrCount ?? 0} />
          <Metric label="진행 중" value={dashboard.data?.stats.runningCount ?? 0} />
          <Metric label="실패" value={dashboard.data?.stats.failedCount ?? 0} />
          <Metric label="댓글 작성됨" value={dashboard.data?.stats.commentedCount ?? 0} />
          <Metric label="오탐 피드백" value={dashboard.data?.stats.falsePositiveCount ?? 0} />
          <Metric label="평균 리뷰 시간" value={dashboard.data?.stats.averageReviewSeconds ?? 0} suffix="초" />
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

function Metric({ label, value, suffix = "" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}{suffix}</strong>
    </div>
  );
}
