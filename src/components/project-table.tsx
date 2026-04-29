"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Info, RefreshCw, Settings, Trash2 } from "lucide-react";
import { BranchMultiCombobox } from "./gitlab-combobox";
import type { Project, ReviewStrategy } from "../lib/api-client";

type ProjectUpdatePayload = {
  enabled: boolean;
  mrTargetBranches: string[];
  commitBranches: string[];
};

export function ProjectTable({
  projects,
  onUpdate,
  onDelete,
  onUpdateReviewStrategy,
  onUpdateReleaseNotes,
  onResetWebhook,
  onConfigure,
  isAdmin = false,
  resettingProjectId = null
}: {
  projects: Project[];
  onUpdate: (id: number, payload: ProjectUpdatePayload) => void;
  onDelete: (id: number) => void;
  onUpdateReviewStrategy?: (id: number, reviewStrategy: ReviewStrategy) => void;
  onUpdateReleaseNotes?: (id: number, enabled: boolean) => void;
  onResetWebhook?: (id: number) => void;
  onConfigure?: (project: Project) => void;
  isAdmin?: boolean;
  resettingProjectId?: number | null;
}) {
  return (
    <div className="table-wrap project-table-wrap">
      <table className="project-settings-table">
        <thead>
          <tr>
            <th>프로젝트</th>
            <th>MR 리뷰 브랜치</th>
            <th>커밋 리뷰</th>
            <th>
              <span className="table-heading-with-tooltip">
                리뷰 전략
                <span className="tooltip-trigger">
                  <button type="button" className="tooltip-icon" aria-label="리뷰 전략 설명">
                    <Info size={14} />
                  </button>
                  <span className="tooltip-panel" role="tooltip">
                    <strong>리뷰 전략</strong>
                    <span>Auto: Codex가 diff 위험도를 먼저 보고 medium/high/xhigh를 선택합니다.</span>
                    <span>빠름: medium으로 빠르게 리뷰합니다.</span>
                    <span>균형: high로 리뷰 품질과 시간을 균형 있게 가져갑니다.</span>
                    <span>정밀: xhigh로 오래 걸리더라도 깊게 리뷰합니다.</span>
                  </span>
                </span>
              </span>
            </th>
            <th>릴리즈노트</th>
            <th>Webhook</th>
            <th>상태</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              onUpdate={onUpdate}
              onDelete={onDelete}
              onUpdateReviewStrategy={onUpdateReviewStrategy}
              onUpdateReleaseNotes={onUpdateReleaseNotes}
              onResetWebhook={onResetWebhook}
              onConfigure={onConfigure}
              isAdmin={isAdmin}
              isResettingWebhook={resettingProjectId === project.id}
            />
          ))}
          {!projects.length && (
            <tr>
              <td colSpan={8} className="empty">
                설정된 프로젝트가 없습니다
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function ProjectRow({
  project,
  onUpdate,
  onDelete,
  onUpdateReviewStrategy,
  onUpdateReleaseNotes,
  onResetWebhook,
  onConfigure,
  isAdmin,
  isResettingWebhook
}: {
  project: Project;
  onUpdate: (id: number, payload: ProjectUpdatePayload) => void;
  onDelete: (id: number) => void;
  onUpdateReviewStrategy?: (id: number, reviewStrategy: ReviewStrategy) => void;
  onUpdateReleaseNotes?: (id: number, enabled: boolean) => void;
  onResetWebhook?: (id: number) => void;
  onConfigure?: (project: Project) => void;
  isAdmin: boolean;
  isResettingWebhook: boolean;
}) {
  const [mrTargetBranches, setMrTargetBranches] = useState<string[]>(project.mrTargetBranches);
  const [commitBranches, setCommitBranches] = useState<string[]>(project.commitBranches);
  const [enabled, setEnabled] = useState(project.enabled);
  const [releaseNotesEnabled, setReleaseNotesEnabled] = useState(project.releaseNotesEnabled);

  useEffect(() => {
    setMrTargetBranches(project.mrTargetBranches);
    setCommitBranches(project.commitBranches);
    setEnabled(project.enabled);
    setReleaseNotesEnabled(project.releaseNotesEnabled);
  }, [project]);

  function updateProject(next: Partial<ProjectUpdatePayload>) {
    onUpdate(project.id, {
      enabled,
      mrTargetBranches,
      commitBranches,
      ...next
    });
  }

  function updateMrTargetBranches(nextBranches: string[]) {
    setMrTargetBranches(nextBranches);
    updateProject({ mrTargetBranches: nextBranches });
  }

  function updateCommitBranches(nextBranches: string[]) {
    setCommitBranches(nextBranches);
    updateProject({ commitBranches: nextBranches });
  }

  function toggleEnabled() {
    const nextEnabled = !enabled;
    setEnabled(nextEnabled);
    updateProject({ enabled: nextEnabled });
  }

  function toggleReleaseNotes() {
    const nextEnabled = !releaseNotesEnabled;
    setReleaseNotesEnabled(nextEnabled);
    onUpdateReleaseNotes?.(project.id, nextEnabled);
  }

  const projectTitle = [project.displayName, project.webUrl].filter(Boolean).join("\n");
  const namespaceLabel = project.namespaceName ?? "GitLab 그룹 없음";

  return (
    <tr>
      <td>
        <div className="project-cell">
          {project.webUrl ? (
            <a className="icon-button project-home-link" href={project.webUrl} target="_blank" rel="noreferrer" title="GitLab 프로젝트 열기">
              <ExternalLink size={16} />
            </a>
          ) : (
            <span className="icon-button project-home-link disabled" aria-hidden="true">
              <ExternalLink size={16} />
            </span>
          )}
          <div className="project-cell-text" title={projectTitle}>
            <strong>{project.projectName}</strong>
            <small>{namespaceLabel}</small>
          </div>
        </div>
      </td>
      <td>
        <BranchMultiCombobox
          projectId={project.gitlabProjectId}
          values={mrTargetBranches}
          onChange={updateMrTargetBranches}
          placeholder="비활성화"
        />
      </td>
      <td>
        <BranchMultiCombobox
          projectId={project.gitlabProjectId}
          values={commitBranches}
          onChange={updateCommitBranches}
          placeholder="비활성화"
        />
      </td>
      <td>
        <select
          className="compact-input strategy-select"
          value={project.reviewStrategy}
          onChange={(event) => onUpdateReviewStrategy?.(project.id, event.target.value as ReviewStrategy)}
          title={project.reviewStrategyUpdatedAt ? `마지막 변경: ${new Date(project.reviewStrategyUpdatedAt).toLocaleString()}` : "리뷰 전략"}
        >
          <option value="auto">Auto</option>
          <option value="fast">빠름</option>
          <option value="balanced">균형</option>
          <option value="thorough">정밀</option>
        </select>
      </td>
      <td>
        <label className="switch-control" title="v로 시작하는 태그가 생성되면 사용자용 릴리즈노트를 작성합니다">
          <input type="checkbox" checked={releaseNotesEnabled} onChange={toggleReleaseNotes} />
          <span className="switch-track" aria-hidden="true" />
          <span>{releaseNotesEnabled ? "켜짐" : "꺼짐"}</span>
        </label>
      </td>
      <td>
        <WebhookStatus project={project} />
      </td>
      <td>
        <button className={enabled ? "status ok status-button" : "status muted status-button"} onClick={toggleEnabled}>
          {enabled ? "활성" : "일시정지"}
        </button>
      </td>
      <td className="right">
        <div className="button-row end">
          {onConfigure && (
            <button className="icon-button" onClick={() => onConfigure(project)} title="리뷰 설정">
              <Settings size={16} />
            </button>
          )}
          {isAdmin && onResetWebhook && (
            <button
              className="icon-button"
              onClick={() => onResetWebhook(project.id)}
              disabled={isResettingWebhook}
              title="Webhook 재설정"
            >
              <RefreshCw size={16} />
            </button>
          )}
          <button className="icon-button danger" onClick={() => onDelete(project.id)} title="프로젝트 삭제">
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function WebhookStatus({ project }: { project: Project }) {
  const label =
    project.webhookStatus === "connected" ? "연결됨" : project.webhookStatus === "error" ? "생성 실패" : "미설정";
  const className =
    project.webhookStatus === "connected"
      ? "status ok"
      : project.webhookStatus === "error"
        ? "status bad"
        : "status muted";

  return (
    <div className="webhook-status">
      <span className={className}>{label}</span>
      {project.webhookError && <small title={project.webhookError}>{project.webhookError}</small>}
      {!project.webhookError && project.webhookLastVerifiedAt && (
        <small>{new Date(project.webhookLastVerifiedAt).toLocaleString()}</small>
      )}
    </div>
  );
}
