import type { ReviewEvent } from "../lib/api-client";
import type { ReactNode } from "react";
import { CheckCircle2, Cpu, Gauge, MessageSquareText, SlidersHorizontal, Terminal, XCircle } from "lucide-react";

const PROGRESS_STAGES = ["대기 중", "GitLab diff 준비", "workspace checkout", "Codex 리뷰", "결과 게시", "완료"];

export function ReviewProgressSummary({ events, status }: { events: ReviewEvent[]; status: string | null }) {
  const activeIndex = progressIndex(events, status);
  const latest = events.at(-1);
  const modelLabel = reviewModelLabel(events);

  return (
    <section className="progress-card">
      <div>
        <span className="eyebrow">현재 단계</span>
        <strong>{PROGRESS_STAGES[activeIndex]}</strong>
        <p>{latest ? messageForEvent(latest) : status === "queued" ? "worker가 리뷰를 가져가길 기다리는 중입니다." : "리뷰 이벤트를 기다리는 중입니다."}</p>
        {modelLabel && <p>리뷰 모델: {modelLabel}</p>}
      </div>
      <ol className="progress-steps">
        {PROGRESS_STAGES.map((stage, index) => (
          <li key={stage} className={progressClass(index, activeIndex, status)}>
            <span>{index + 1}</span>
            {stage}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function ReviewEventTimeline({ events, isLoading }: { events: ReviewEvent[]; isLoading: boolean }) {
  if (isLoading) {
    return <div className="empty compact">리뷰 이벤트를 불러오는 중...</div>;
  }

  if (!events.length) {
    return <div className="empty compact">아직 기록된 리뷰 이벤트가 없습니다</div>;
  }

  return (
    <ol className="event-timeline">
      {events.map((event) => <TimelineEvent key={event.id} event={event} />)}
    </ol>
  );
}

function TimelineEvent({ event }: { event: ReviewEvent }) {
  if (event.step === "codex_started") return <CodexStartedEvent event={event} />;
  if (event.step === "review_strategy_selected" || event.step === "codex_triage_finished" || event.step === "codex_triage_failed") {
    return <StrategyEvent event={event} />;
  }
  if (event.step === "codex_tool_used") return <CodexToolEvent event={event} />;
  if (event.step === "codex_message") return <CodexMessageEvent event={event} />;
  if (event.step === "codex_usage") return <CodexUsageEvent event={event} />;
  if (event.step === "codex_failed" || event.step === "run_failed") return <ErrorEvent event={event} />;
  return <CheckpointEvent event={event} />;
}

function CheckpointEvent({ event }: { event: ReviewEvent }) {
  return (
    <li className={`event-item event-checkpoint ${event.level}`}>
      <EventHeader event={event} icon={<CheckCircle2 size={15} />} title={labelForStep(event.step)} />
      <p>{messageForEvent(event)}</p>
      <RawMetadata event={event} />
    </li>
  );
}

function CodexStartedEvent({ event }: { event: ReviewEvent }) {
  const model = stringMetadata(event, "model") ?? "Codex";
  const effort = stringMetadata(event, "modelReasoningEffort");
  const promptVersion = stringMetadata(event, "promptVersion");
  return (
    <li className="event-item codex-activity">
      <EventHeader event={event} icon={<Cpu size={16} />} title="Codex 리뷰 시작" />
      <div className="activity-badges">
        <span>{model}</span>
        {effort && <span>{effort}</span>}
        {promptVersion && <span>{promptVersion}</span>}
      </div>
      <RawMetadata event={event} />
    </li>
  );
}

function StrategyEvent({ event }: { event: ReviewEvent }) {
  const strategy = stringMetadata(event, "reviewStrategy");
  const effort = stringMetadata(event, "effectiveReasoningEffort") ?? stringMetadata(event, "modelReasoningEffort");
  const riskLevel = stringMetadata(event, "triageRiskLevel");
  const reason = stringMetadata(event, "triageReason");
  const signals = arrayMetadata(event, "triageRiskSignals");
  return (
    <li className={`event-item codex-activity ${event.level}`}>
      <EventHeader event={event} icon={<SlidersHorizontal size={16} />} title={labelForStep(event.step)} badge={effort ?? undefined} />
      <div className="activity-badges">
        {strategy && <span>{strategyLabel(strategy)}</span>}
        {riskLevel && <span>위험도 {riskLevelLabel(riskLevel)}</span>}
      </div>
      {reason && <p>{reason}</p>}
      {signals.length > 0 && (
        <ul className="compact-list">
          {signals.slice(0, 5).map((signal) => (
            <li key={signal}>{signal}</li>
          ))}
        </ul>
      )}
      <RawMetadata event={event} />
    </li>
  );
}

function CodexToolEvent({ event }: { event: ReviewEvent }) {
  const command = stringMetadata(event, "command");
  const outputPreview = stringMetadata(event, "outputPreview");
  const status = stringMetadata(event, "status") ?? event.level;
  const exitCode = numberMetadata(event, "exitCode");
  const outputBytes = numberMetadata(event, "outputBytes");
  const outputTruncated = booleanMetadata(event, "outputTruncated");
  const tool = stringMetadata(event, "tool") ?? "tool";

  return (
    <li className={`event-item codex-activity ${event.level}`}>
      <EventHeader event={event} icon={<Terminal size={16} />} title="도구 사용" badge={statusLabel(status)} />
      <p className="activity-subtitle">{toolLabel(tool)}</p>
      {command && (
        <pre className="terminal-card">
          <code>$ {command}</code>
          {outputPreview && <code>{outputPreview}</code>}
        </pre>
      )}
      <div className="activity-meta-row">
        {exitCode !== null && <span>exit {exitCode}</span>}
        {outputBytes !== null && <span>출력 {formatBytes(outputBytes)}</span>}
        {outputTruncated && <span>미리보기 일부 생략</span>}
      </div>
      <RawMetadata event={event} />
    </li>
  );
}

function CodexMessageEvent({ event }: { event: ReviewEvent }) {
  const markdownPreview = stringMetadata(event, "markdownPreview");
  const assessment = stringMetadata(event, "assessment");
  const issueCount = numberMetadata(event, "issueCount");
  const hasFindings = booleanMetadata(event, "hasFindings");
  const truncated = booleanMetadata(event, "markdownPreviewTruncated");

  return (
    <li className="event-item codex-activity codex-message">
      <EventHeader event={event} icon={<MessageSquareText size={16} />} title="Codex 메시지" badge={hasFindings ? "이슈 있음" : "이슈 없음"} />
      <div className="activity-meta-row">
        {assessment && <span>{assessment}</span>}
        {issueCount !== null && <span>이슈 {issueCount}개</span>}
      </div>
      {markdownPreview && <pre className="message-preview">{markdownPreview}{truncated ? "\n..." : ""}</pre>}
      <RawMetadata event={event} />
    </li>
  );
}

function CodexUsageEvent({ event }: { event: ReviewEvent }) {
  const input = numberMetadata(event, "inputTokens");
  const cached = numberMetadata(event, "cachedInputTokens");
  const output = numberMetadata(event, "outputTokens");
  const reasoning = numberMetadata(event, "reasoningOutputTokens");
  const total = numberMetadata(event, "totalTokens");

  return (
    <li className="event-item codex-activity compact">
      <EventHeader event={event} icon={<Gauge size={16} />} title="토큰 사용량" />
      <div className="usage-grid">
        <Metric label="입력" value={input} />
        <Metric label="캐시" value={cached} />
        <Metric label="출력" value={output} />
        <Metric label="Reasoning" value={reasoning} />
        <Metric label="전체" value={total} />
      </div>
      <RawMetadata event={event} />
    </li>
  );
}

function ErrorEvent({ event }: { event: ReviewEvent }) {
  return (
    <li className="event-item error codex-activity">
      <EventHeader event={event} icon={<XCircle size={16} />} title={labelForStep(event.step)} badge="실패" />
      <p>{messageForEvent(event)}</p>
      <RawMetadata event={event} />
    </li>
  );
}

function EventHeader({ event, icon, title, badge }: { event: ReviewEvent; icon: ReactNode; title: string; badge?: string }) {
  return (
    <div className="event-header">
      <strong>
        {icon}
        {title}
      </strong>
      <span>{new Date(event.createdAt).toLocaleString()}</span>
      {badge && <em>{badge}</em>}
    </div>
  );
}

function RawMetadata({ event }: { event: ReviewEvent }) {
  if (!Object.keys(event.metadata).length) return null;
  return (
    <details className="raw-metadata">
      <summary>원본 metadata</summary>
      <code>{JSON.stringify(event.metadata)}</code>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value?.toLocaleString() ?? "-"}</strong>
    </div>
  );
}

function progressIndex(events: ReviewEvent[], status: string | null): number {
  if (status === "commented" || status === "no_findings" || status === "failed") return 5;
  const latestStep = events.at(-1)?.step;
  if (!latestStep) return status === "running" ? 1 : 0;
  if (["run_finished", "comment_posted", "no_findings", "run_failed"].includes(latestStep)) return 5;
  if (latestStep === "codex_finished") return 4;
  if (latestStep.startsWith("codex_") || latestStep === "review_strategy_selected") return 3;
  if (latestStep.startsWith("workspace_")) return 2;
  if (["job_claimed", "run_started", "bot_token_loaded", "gitlab_project_resolved", "lock_acquired", "diff_fetched"].includes(latestStep)) return 1;
  return 0;
}

function progressClass(index: number, activeIndex: number, status: string | null): string {
  if (status === "failed" && index === activeIndex) return "failed";
  if (index < activeIndex) return "done";
  if (index === activeIndex) return "active";
  return "";
}

function labelForStep(step: string): string {
  const label = STEP_LABELS[step];
  if (label) return label;
  return step
    .split("_")
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

const STEP_LABELS: Record<string, string> = {
  run_queued: "리뷰 대기열 등록",
  job_claimed: "worker 작업 시작",
  run_started: "리뷰 실행 시작",
  bot_token_loaded: "Reviewer Bot 토큰 확인",
  gitlab_project_resolved: "GitLab 프로젝트 확인",
  lock_acquired: "리뷰 lock 획득",
  diff_fetched: "diff 가져오기",
  workspace_checkout_started: "workspace checkout 시작",
  workspace_checkout_finished: "workspace checkout 완료",
  review_strategy_selected: "리뷰 전략 선택",
  codex_triage_started: "Auto triage 시작",
  codex_triage_finished: "Auto triage 완료",
  codex_triage_failed: "Auto triage 실패",
  codex_started: "Codex 리뷰 시작",
  codex_tool_used: "도구 사용",
  codex_message: "Codex 메시지",
  codex_usage: "토큰 사용량",
  codex_finished: "Codex 리뷰 완료",
  comment_posted: "댓글 게시",
  no_findings: "이슈 없음",
  run_failed: "리뷰 실패",
  run_finished: "리뷰 완료"
};

function messageForEvent(event: ReviewEvent): string {
  return EVENT_MESSAGES[event.step] ?? event.message;
}

const EVENT_MESSAGES: Record<string, string> = {
  run_queued: "리뷰가 대기열에 등록되었습니다.",
  job_claimed: "worker가 리뷰 작업을 시작했습니다.",
  run_started: "리뷰 실행이 시작되었습니다.",
  bot_token_loaded: "Reviewer Bot 토큰을 확인했습니다.",
  gitlab_project_resolved: "GitLab 프로젝트 정보를 확인했습니다.",
  lock_acquired: "리뷰 lock을 획득했습니다.",
  diff_fetched: "GitLab diff를 가져왔습니다.",
  workspace_checkout_started: "workspace checkout을 시작했습니다.",
  workspace_checkout_finished: "workspace checkout을 완료했습니다.",
  review_strategy_selected: "리뷰 전략과 실행 강도를 선택했습니다.",
  codex_triage_started: "Auto 전략이 본 리뷰 강도를 판단하고 있습니다.",
  codex_triage_finished: "Auto triage가 본 리뷰 강도를 선택했습니다.",
  codex_triage_failed: "Auto triage가 실패해 안전 기본값으로 진행합니다.",
  codex_started: "Codex 리뷰가 시작되었습니다.",
  codex_finished: "Codex 리뷰가 완료되었습니다.",
  comment_posted: "GitLab 댓글을 게시했습니다.",
  no_findings: "액션이 필요한 이슈는 없습니다.",
  run_failed: "리뷰 실행이 실패했습니다.",
  run_finished: "리뷰 실행이 완료되었습니다."
};

function reviewModelLabel(events: ReviewEvent[]): string | null {
  const metadata = events.find((event) => event.step === "codex_started")?.metadata;
  const model = metadata?.model;
  const effort = metadata?.modelReasoningEffort;
  const strategy = metadata?.reviewStrategy;
  if (typeof model !== "string") return null;
  if (typeof strategy === "string" && typeof effort === "string") return `${model} / ${strategy} → ${effort}`;
  return typeof effort === "string" ? `${model} / ${effort}` : model;
}

function stringMetadata(event: ReviewEvent, key: string): string | null {
  const value = event.metadata[key];
  return typeof value === "string" ? value : null;
}

function numberMetadata(event: ReviewEvent, key: string): number | null {
  const value = event.metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanMetadata(event: ReviewEvent, key: string): boolean | null {
  const value = event.metadata[key];
  return typeof value === "boolean" ? value : null;
}

function arrayMetadata(event: ReviewEvent, key: string): string[] {
  const value = event.metadata[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function strategyLabel(strategy: string): string {
  if (strategy === "auto") return "Auto";
  if (strategy === "fast") return "빠름";
  if (strategy === "balanced") return "균형";
  if (strategy === "thorough") return "정밀";
  return strategy;
}

function riskLevelLabel(riskLevel: string): string {
  if (riskLevel === "low") return "낮음";
  if (riskLevel === "medium") return "중간";
  if (riskLevel === "high") return "높음";
  return riskLevel;
}

function toolLabel(tool: string): string {
  if (tool === "command_execution") return "읽기 전용 shell 명령";
  if (tool === "web_search") return "웹 검색";
  return tool;
}

function statusLabel(status: string): string {
  if (status === "completed") return "완료";
  if (status === "failed") return "실패";
  if (status === "running") return "실행 중";
  return status;
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
