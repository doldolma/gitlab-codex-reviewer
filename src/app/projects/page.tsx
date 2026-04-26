"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { BranchMultiCombobox, GitLabProjectCombobox } from "../../components/gitlab-combobox";
import { ProjectTable } from "../../components/project-table";
import { apiGet, apiSend, type GitLabProjectOption, type Project } from "../../lib/api-client";

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ projects: Project[] }>("/api/projects")
  });

  const createProject = useMutation({
    mutationFn: (payload: {
      gitlabProjectId: string;
      displayName: string;
      enabled: boolean;
      skipLabels: string[];
      mrTargetBranches: string[];
      commitBranches: string[];
    }) => apiSend("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });

  const updateProject = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: Omit<Project, "id" | "gitlabProjectRefId" | "gitlabProjectId"> }) =>
      apiSend(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });

  const deleteProject = useMutation({
    mutationFn: (id: number) => apiSend(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });

  const [gitlabProjectId, setGitlabProjectId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [skipLabels, setSkipLabels] = useState("skip-codex-review");
  const [mrTargetBranches, setMrTargetBranches] = useState<string[]>([]);
  const [commitBranches, setCommitBranches] = useState<string[]>([]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!gitlabProjectId.trim()) return;
    createProject.mutate({
      gitlabProjectId,
      displayName,
      enabled: true,
      skipLabels: splitCsv(skipLabels),
      mrTargetBranches,
      commitBranches
    });
    setGitlabProjectId("");
    setDisplayName("");
    setMrTargetBranches([]);
    setCommitBranches([]);
  }

  function handleProjectSelect(project: GitLabProjectOption) {
    if (!displayName.trim()) setDisplayName(project.nameWithNamespace);
  }

  return (
    <AppShell>
      <div className="page">
        <header className="page-header">
          <div>
            <span className="eyebrow">설정</span>
            <h1>Projects</h1>
            <p>감시할 GitLab 프로젝트와 MR 대상 브랜치, 커밋 리뷰 브랜치를 설정합니다.</p>
          </div>
        </header>

        <section className="panel">
          <form className="project-form project-create-form" onSubmit={submit}>
            <label>
              <span>표시 이름</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
            </label>
            <label>
              <span>GitLab 프로젝트</span>
              <GitLabProjectCombobox
                value={gitlabProjectId}
                onChange={setGitlabProjectId}
                onProjectSelect={handleProjectSelect}
                required
              />
            </label>
            <label>
              <span>건너뛸 label</span>
              <input value={skipLabels} onChange={(event) => setSkipLabels(event.target.value)} />
            </label>
            <label>
              <span>MR 대상 브랜치</span>
              <BranchMultiCombobox
                projectId={gitlabProjectId}
                values={mrTargetBranches}
                onChange={setMrTargetBranches}
                placeholder="모든 opened MR"
              />
            </label>
            <label>
              <span>커밋 리뷰 브랜치</span>
              <BranchMultiCombobox
                projectId={gitlabProjectId}
                values={commitBranches}
                onChange={setCommitBranches}
                placeholder="비활성화"
              />
            </label>
            <button className="button form-submit" type="submit" disabled={createProject.isPending || !gitlabProjectId.trim()}>
              <Plus size={16} />
              추가
            </button>
          </form>
        </section>

        <section className="panel">
          <ProjectTable
            projects={projects.data?.projects ?? []}
            onUpdate={(id, payload) => updateProject.mutate({ id, payload })}
            onDelete={(id) => deleteProject.mutate(id)}
          />
        </section>
      </div>
    </AppShell>
  );
}

function splitCsv(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}
