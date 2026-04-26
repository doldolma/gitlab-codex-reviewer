"use client";

import { useEffect, useMemo, useState } from "react";
import { Save, Trash2 } from "lucide-react";
import { BranchMultiCombobox } from "./gitlab-combobox";
import type { Project } from "../lib/api-client";

type ProjectUpdatePayload = Omit<Project, "id" | "gitlabProjectRefId" | "gitlabProjectId">;

export function ProjectTable({
  projects,
  onUpdate,
  onDelete
}: {
  projects: Project[];
  onUpdate: (id: number, payload: ProjectUpdatePayload) => void;
  onDelete: (id: number) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>프로젝트</th>
            <th>GitLab ID / Path</th>
            <th>건너뛸 Labels</th>
            <th>MR 대상</th>
            <th>커밋 브랜치</th>
            <th>상태</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {projects.map((project) => (
            <ProjectRow key={project.id} project={project} onUpdate={onUpdate} onDelete={onDelete} />
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
  onDelete
}: {
  project: Project;
  onUpdate: (id: number, payload: ProjectUpdatePayload) => void;
  onDelete: (id: number) => void;
}) {
  const [displayName, setDisplayName] = useState(project.displayName);
  const [skipLabels, setSkipLabels] = useState(project.skipLabels.join(", "));
  const [mrTargetBranches, setMrTargetBranches] = useState<string[]>(project.mrTargetBranches);
  const [commitBranches, setCommitBranches] = useState<string[]>(project.commitBranches);
  const [enabled, setEnabled] = useState(project.enabled);

  useEffect(() => {
    setDisplayName(project.displayName);
    setSkipLabels(project.skipLabels.join(", "));
    setMrTargetBranches(project.mrTargetBranches);
    setCommitBranches(project.commitBranches);
    setEnabled(project.enabled);
  }, [project]);

  const payload = useMemo<ProjectUpdatePayload>(
    () => ({
      displayName,
      enabled,
      skipLabels: splitCsv(skipLabels),
      mrTargetBranches,
      commitBranches
    }),
    [commitBranches, displayName, enabled, mrTargetBranches, skipLabels]
  );

  const isDirty =
    payload.displayName !== project.displayName ||
    payload.enabled !== project.enabled ||
    payload.skipLabels.join(",") !== project.skipLabels.join(",") ||
    payload.mrTargetBranches.join(",") !== project.mrTargetBranches.join(",") ||
    payload.commitBranches.join(",") !== project.commitBranches.join(",");

  return (
    <tr>
      <td>
        <input className="compact-input" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
      </td>
      <td className="mono">{project.gitlabProjectId}</td>
      <td>
        <input className="compact-input" value={skipLabels} onChange={(event) => setSkipLabels(event.target.value)} />
      </td>
      <td>
        <BranchMultiCombobox
          projectId={project.gitlabProjectId}
          values={mrTargetBranches}
          onChange={setMrTargetBranches}
          placeholder="모든 opened MR"
        />
      </td>
      <td>
        <BranchMultiCombobox
          projectId={project.gitlabProjectId}
          values={commitBranches}
          onChange={setCommitBranches}
          placeholder="비활성화"
        />
      </td>
      <td>
        <button className={enabled ? "status ok status-button" : "status muted status-button"} onClick={() => setEnabled(!enabled)}>
          {enabled ? "활성" : "일시정지"}
        </button>
      </td>
      <td className="right">
        <div className="button-row end">
          <button className="icon-button" onClick={() => onUpdate(project.id, payload)} disabled={!isDirty} title="프로젝트 저장">
            <Save size={16} />
          </button>
          <button className="icon-button danger" onClick={() => onDelete(project.id)} title="프로젝트 삭제">
            <Trash2 size={16} />
          </button>
        </div>
      </td>
    </tr>
  );
}

function splitCsv(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}
