"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { BranchMultiCombobox, GitLabProjectCombobox } from "../../components/gitlab-combobox";
import { ProjectReviewConfigDrawer } from "../../components/project-review-config-drawer";
import { ProjectTable } from "../../components/project-table";
import { apiGet, apiSend, type AuthStatus, type Project, type ReviewStrategy } from "../../lib/api-client";

type ProjectUpdatePayload = {
  enabled: boolean;
  mrTargetBranches: string[];
  commitBranches: string[];
};

export default function ProjectsPage() {
  const queryClient = useQueryClient();
  const auth = useQuery({ queryKey: ["auth-status"], queryFn: () => apiGet<AuthStatus>("/api/auth/status") });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<{ projects: Project[] }>("/api/projects")
  });
  const [resettingWebhookProjectId, setResettingWebhookProjectId] = useState<number | null>(null);
  const [configProject, setConfigProject] = useState<Project | null>(null);

  const createProject = useMutation({
    mutationFn: (payload: {
      gitlabProjectId: string;
      enabled: boolean;
      mrTargetBranches: string[];
      commitBranches: string[];
    }) => apiSend("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });

  const updateProject = useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: ProjectUpdatePayload }) =>
      apiSend(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });

  const deleteProject = useMutation({
    mutationFn: (id: number) => apiSend(`/api/projects/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });

  const updateReviewStrategy = useMutation({
    mutationFn: ({ id, reviewStrategy }: { id: number; reviewStrategy: ReviewStrategy }) =>
      apiSend(`/api/projects/${id}/review-strategy`, { method: "PATCH", body: JSON.stringify({ reviewStrategy }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });

  const updateReleaseNotes = useMutation({
    mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) =>
      apiSend(`/api/projects/${id}/release-notes`, { method: "PATCH", body: JSON.stringify({ enabled }) }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] })
  });

  const resetWebhook = useMutation({
    mutationFn: (id: number) => {
      setResettingWebhookProjectId(id);
      return apiSend(`/api/projects/${id}/webhook/reset`, { method: "POST" });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
    onSettled: () => setResettingWebhookProjectId(null)
  });

  const [gitlabProjectId, setGitlabProjectId] = useState("");
  const [mrTargetBranches, setMrTargetBranches] = useState<string[]>([]);
  const [commitBranches, setCommitBranches] = useState<string[]>([]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!gitlabProjectId.trim()) return;
    createProject.mutate({
      gitlabProjectId,
      enabled: true,
      mrTargetBranches,
      commitBranches
    });
    setGitlabProjectId("");
    setMrTargetBranches([]);
    setCommitBranches([]);
  }

  return (
    <AppShell>
      <div className="page">
        <header className="page-header">
          <div>
            <span className="eyebrow">설정</span>
            <h1>Projects</h1>
            <p>감시할 GitLab 프로젝트와 리뷰할 브랜치를 설정합니다. 비워둔 리뷰 유형은 실행하지 않습니다.</p>
          </div>
        </header>

        <section className="panel">
          <form className="project-form project-create-form" onSubmit={submit}>
            <label>
              <span>GitLab 프로젝트</span>
              <GitLabProjectCombobox value={gitlabProjectId} onChange={setGitlabProjectId} required />
            </label>
            <label>
              <span>MR 리뷰 브랜치</span>
              <BranchMultiCombobox
                projectId={gitlabProjectId}
                values={mrTargetBranches}
                onChange={setMrTargetBranches}
                placeholder="비활성화"
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
            onUpdateReviewStrategy={(id, reviewStrategy) => updateReviewStrategy.mutate({ id, reviewStrategy })}
            onUpdateReleaseNotes={(id, enabled) => updateReleaseNotes.mutate({ id, enabled })}
            isAdmin={auth.data?.currentUser?.role === "admin"}
            onResetWebhook={(id) => resetWebhook.mutate(id)}
            onConfigure={setConfigProject}
            resettingProjectId={resettingWebhookProjectId}
          />
        </section>
        <ProjectReviewConfigDrawer project={configProject} onClose={() => setConfigProject(null)} />
      </div>
    </AppShell>
  );
}
