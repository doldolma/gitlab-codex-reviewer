"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { apiGet, apiSend, type Project, type ProjectReviewConfig, type ReviewProfile } from "../lib/api-client";

export function ProjectReviewConfigDrawer({ project, onClose }: { project: Project | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [reviewProfile, setReviewProfile] = useState<ReviewProfile>("assertive");
  const [pathFiltersText, setPathFiltersText] = useState("");
  const [instructions, setInstructions] = useState<ProjectReviewConfig["instructions"]>([]);

  const config = useQuery({
    queryKey: ["project-review-config", project?.id],
    queryFn: () => apiGet<{ config: ProjectReviewConfig }>(`/api/projects/${project!.id}/review-config`),
    enabled: Boolean(project?.id)
  });

  useEffect(() => {
    if (!config.data?.config) return;
    setReviewProfile(config.data.config.reviewProfile);
    setPathFiltersText(config.data.config.pathFilters.join("\n"));
    setInstructions(config.data.config.instructions);
  }, [config.data]);

  const save = useMutation({
    mutationFn: () =>
      apiSend<{ config: ProjectReviewConfig }>(`/api/projects/${project!.id}/review-config`, {
        method: "PATCH",
        body: JSON.stringify({
          reviewProfile,
          pathFilters: pathFiltersText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
          instructions
        })
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
      void queryClient.invalidateQueries({ queryKey: ["project-review-config", project?.id] });
    }
  });

  if (!project) return null;

  function submit(event: FormEvent) {
    event.preventDefault();
    save.mutate();
  }

  function updateInstruction(index: number, next: Partial<ProjectReviewConfig["instructions"][number]>) {
    setInstructions((current) => current.map((instruction, itemIndex) => itemIndex === index ? { ...instruction, ...next } : instruction));
  }

  function removeInstruction(index: number) {
    setInstructions((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer wide" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">리뷰 설정</span>
            <h2>{project.displayName}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="닫기">
            <X size={18} />
          </button>
        </header>

        {config.isLoading ? (
          <div className="empty compact">리뷰 설정을 불러오는 중...</div>
        ) : (
          <form className="stacked-form" onSubmit={submit}>
            <label>
              <span>리뷰 프로필</span>
              <select value={reviewProfile} onChange={(event) => setReviewProfile(event.target.value as ReviewProfile)}>
                <option value="assertive">Assertive - 의미 있는 위험을 적극적으로 탐색</option>
                <option value="chill">Chill - 확실한 버그와 회귀 위주</option>
              </select>
            </label>

            <label>
              <span>리뷰 경로 필터</span>
              <textarea
                value={pathFiltersText}
                onChange={(event) => setPathFiltersText(event.target.value)}
                rows={7}
                placeholder={"!dist/**\n!node_modules/**\nsrc/**"}
              />
            </label>

            <div className="drawer-section">
              <div className="section-heading compact">
                <h3>Path instructions</h3>
                <button
                  className="button secondary small"
                  type="button"
                  onClick={() => setInstructions((current) => [...current, { id: 0, pathGlob: "src/**", instructions: "", enabled: true }])}
                >
                  <Plus size={14} />
                  추가
                </button>
              </div>

              <div className="instruction-list">
                {instructions.map((instruction, index) => (
                  <div className="instruction-card" key={`${instruction.id}-${index}`}>
                    <div className="instruction-card-header">
                      <label className="checkbox-row">
                        <input
                          type="checkbox"
                          checked={instruction.enabled}
                          onChange={(event) => updateInstruction(index, { enabled: event.target.checked })}
                        />
                        활성
                      </label>
                      <button className="icon-button danger" type="button" onClick={() => removeInstruction(index)} title="삭제">
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <label>
                      <span>경로 glob</span>
                      <input
                        value={instruction.pathGlob}
                        onChange={(event) => updateInstruction(index, { pathGlob: event.target.value })}
                        placeholder="internal/grpcserver/**"
                      />
                    </label>
                    <label>
                      <span>리뷰 지시</span>
                      <textarea
                        value={instruction.instructions}
                        onChange={(event) => updateInstruction(index, { instructions: event.target.value })}
                        rows={4}
                        placeholder="stream lifecycle, context cancel, goroutine cleanup을 중점적으로 확인"
                      />
                    </label>
                  </div>
                ))}
                {!instructions.length && <div className="empty compact">아직 추가된 path instruction이 없습니다</div>}
              </div>
            </div>

            {save.error && <div className="alert error">{save.error.message}</div>}
            <button className="button full" type="submit" disabled={save.isPending}>
              저장
            </button>
          </form>
        )}
      </aside>
    </div>
  );
}
