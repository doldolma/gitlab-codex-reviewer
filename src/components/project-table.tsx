"use client";

import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw, Trash2 } from "lucide-react";
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
  onResetWebhook,
  isAdmin = false,
  resettingProjectId = null
}: {
  projects: Project[];
  onUpdate: (id: number, payload: ProjectUpdatePayload) => void;
  onDelete: (id: number) => void;
  onUpdateReviewStrategy?: (id: number, reviewStrategy: ReviewStrategy) => void;
  onResetWebhook?: (id: number) => void;
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
            <th>리뷰 전략</th>
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
              onResetWebhook={onResetWebhook}
              isAdmin={isAdmin}
              isResettingWebhook={resettingProjectId === project.id}
            />
          ))}
          {!projects.length && (
            <tr>
              <td colSpan={7} className="empty">
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
  onResetWebhook,
  isAdmin,
  isResettingWebhook
}: {
  project: Project;
  onUpdate: (id: number, payload: ProjectUpdatePayload) => void;
  onDelete: (id: number) => void;
  onUpdateReviewStrategy?: (id: number, reviewStrategy: ReviewStrategy) => void;
  onResetWebhook?: (id: number) => void;
  isAdmin: boolean;
  isResettingWebhook: boolean;
}) {
  const [mrTargetBranches, setMrTargetBranches] = useState<string[]>(project.mrTargetBranches);
  const [commitBranches, setCommitBranches] = useState<string[]>(project.commitBranches);
  const [enabled, setEnabled] = useState(project.enabled);

  useEffect(() => {
    setMrTargetBranches(project.mrTargetBranches);
    setCommitBranches(project.commitBranches);
    setEnabled(project.enabled);
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
          <div>
            <strong>{project.displayName}</strong>
            <small>{project.webUrl ?? "GitLab URL 없음"}</small>
          </div>
        </div>
      </td>
      <td>
        <BranchMultiCombobox
          projectId={project.gitlabProjectId}
          values={mrTargetBranches}
          onChange={updateMrTargetBranches}
          placeholder="모든 opened MR"
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
        <WebhookStatus project={project} />
      </td>
      <td>
        <button className={enabled ? "status ok status-button" : "status muted status-button"} onClick={toggleEnabled}>
          {enabled ? "활성" : "일시정지"}
        </button>
      </td>
      <td className="right">
        <div className="button-row end">
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
