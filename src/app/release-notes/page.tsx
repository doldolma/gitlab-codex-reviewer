"use client";

import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Play, RefreshCw, X } from "lucide-react";
import { AppShell } from "../../components/app-shell";
import { GitLabProjectCombobox, TagCombobox } from "../../components/gitlab-combobox";
import { ReleaseNoteProgressSummary, ReviewEventTimeline } from "../../components/review-event-timeline";
import { apiGet, apiSend, type ReleaseNote, type ReviewEvent, type ReviewJob } from "../../lib/api-client";

export default function ReleaseNotesPage() {
  const queryClient = useQueryClient();
  const [gitlabProjectId, setGitlabProjectId] = useState("");
  const [tagName, setTagName] = useState("");
  const [selected, setSelected] = useState<ReleaseNote | null>(null);
  const releaseNotes = useQuery({
    queryKey: ["release-notes"],
    queryFn: () => apiGet<{ releaseNotes: ReleaseNote[] }>("/api/release-notes"),
    refetchInterval: (query) => (hasActiveNotes(query.state.data?.releaseNotes ?? []) ? 1000 : false)
  });
  const notes = releaseNotes.data?.releaseNotes ?? [];
  const selectedNote = selected ? notes.find((note) => note.id === selected.id) ?? selected : null;

  const manualReleaseNote = useMutation({
    mutationFn: (payload: { gitlabProjectId: string; tagName: string }) =>
      apiSend<{ releaseNote: ReleaseNote; job: ReviewJob }>("/api/release-notes/review", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess: (result) => {
      setTagName("");
      setSelected(result.releaseNote);
      void queryClient.invalidateQueries({ queryKey: ["release-notes"] });
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: ["release-notes"] });
    }
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!gitlabProjectId.trim() || !tagName.trim()) return;
    manualReleaseNote.mutate({ gitlabProjectId, tagName });
  }

  return (
    <AppShell>
      <div className="page">
        <header className="page-header">
          <div>
            <span className="eyebrow">릴리즈</span>
            <h1>Release Notes</h1>
            <p>v로 시작하는 GitLab 태그가 생성될 때 자동 작성된 사용자용 릴리즈노트를 확인합니다.</p>
          </div>
          <div className="button-row">
            <button className="button secondary" onClick={() => releaseNotes.refetch()}>
              <RefreshCw size={16} />
              새로고침
            </button>
          </div>
        </header>

        <section className="panel">
          <form className="project-form commit-review-form" onSubmit={submit}>
            <label>
              <span>GitLab 프로젝트</span>
              <GitLabProjectCombobox
                value={gitlabProjectId}
                onChange={(value) => {
                  setGitlabProjectId(value);
                  setTagName("");
                }}
                required
              />
            </label>
            <label>
              <span>태그</span>
              <TagCombobox projectId={gitlabProjectId} value={tagName} onChange={setTagName} placeholder="v 태그 선택" />
            </label>
            <button
              className="button form-submit"
              type="submit"
              disabled={manualReleaseNote.isPending || !gitlabProjectId.trim() || !tagName.trim()}
            >
              <Play size={16} />
              릴리즈노트 작성
            </button>
          </form>
          {manualReleaseNote.isError && (
            <div className="alert bad">
              {manualReleaseNote.error instanceof Error ? manualReleaseNote.error.message : "릴리즈노트 작성 요청에 실패했습니다"}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>릴리즈</th>
                  <th>프로젝트</th>
                  <th>범위</th>
                  <th>상태</th>
                  <th>커밋</th>
                  <th>작성 완료</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {notes.map((note) => (
                  <ReleaseNoteRow key={note.id} note={note} onSelect={setSelected} />
                ))}
                {!notes.length && (
                  <tr>
                    <td colSpan={7} className="empty">
                      아직 릴리즈노트가 없습니다
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <ReleaseNoteDrawer note={selectedNote} onClose={() => setSelected(null)} />
      </div>
    </AppShell>
  );
}

function ReleaseNoteRow({ note, onSelect }: { note: ReleaseNote; onSelect: (note: ReleaseNote) => void }) {
  const externalUrl = note.releaseUrl ?? note.tagUrl;
  return (
    <tr onClick={() => onSelect(note)} className="clickable">
      <td>
        <strong>{note.title ?? note.tagName}</strong>
        <span className="subtle mono">{note.tagName}</span>
      </td>
      <td>{note.projectName}</td>
      <td>{note.previousTagName ? `${note.previousTagName} -> ${note.tagName}` : note.tagName}</td>
      <td>
        <span className={`status ${statusClass(note.status)}`}>{labelForStatus(note.status)}</span>
      </td>
      <td>{note.commitCount}</td>
      <td>{note.generatedAt ? new Date(note.generatedAt).toLocaleString() : "아직 없음"}</td>
      <td className="right" onClick={(event) => event.stopPropagation()}>
        {externalUrl && (
          <a className="icon-button" href={externalUrl} target="_blank" rel="noreferrer" title={note.releaseUrl ? "GitLab 릴리즈 열기" : "GitLab 태그 열기"}>
            <ExternalLink size={16} />
          </a>
        )}
      </td>
    </tr>
  );
}

function ReleaseNoteDrawer({ note, onClose }: { note: ReleaseNote | null; onClose: () => void }) {
  const latestEntry = note?.entries[0] ?? null;
  const events = useQuery({
    queryKey: ["review-events", "release_note", latestEntry?.id],
    queryFn: () => apiGet<{ events: ReviewEvent[] }>(`/api/release-notes/entries/${latestEntry!.id}/events`),
    enabled: Boolean(latestEntry?.id),
    refetchInterval: isActiveStatus(latestEntry?.status ?? note?.status ?? null) ? 1000 : false
  });

  if (!note) return null;
  const externalUrl = note.releaseUrl ?? note.tagUrl;
  const latestStatus = latestEntry?.status ?? note.status;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer review-detail-drawer" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span className="eyebrow">릴리즈노트</span>
            <h2>{note.title ?? note.tagName}</h2>
          </div>
          <button className="icon-button" onClick={onClose} title="닫기">
            <X size={18} />
          </button>
        </header>
        <div className="review-detail-overview">
          <dl className="detail-list">
            <dt>프로젝트</dt>
            <dd>{note.projectName}</dd>
            <dt>태그</dt>
            <dd className="mono">{note.tagName}</dd>
            <dt>비교 기준</dt>
            <dd>{note.previousTagName ?? "첫 v 태그"}</dd>
            <dt>상태</dt>
            <dd>{labelForStatus(note.status)}</dd>
            <dt>작성 완료</dt>
            <dd>{note.generatedAt ? new Date(note.generatedAt).toLocaleString() : "아직 없음"}</dd>
          </dl>
          <ReleaseNoteProgressSummary events={events.data?.events ?? []} status={latestStatus} />
        </div>
        {note.errorMessage && <pre className="error-box">{note.errorMessage}</pre>}
        {note.status === "queued" && <div className="alert neutral">릴리즈노트 작성 대기 중입니다.</div>}
        {note.status === "running" && <div className="alert neutral">릴리즈노트를 작성하고 있습니다.</div>}
        <section className="drawer-section">
          <h3>실행 기록</h3>
          <ReviewEventTimeline
            events={events.data?.events ?? []}
            isLoading={events.isLoading}
            loadingText="릴리즈노트 이벤트를 불러오는 중..."
            emptyText="아직 기록된 릴리즈노트 이벤트가 없습니다"
          />
        </section>
        {note.notesMarkdown && (
          <section className="drawer-section">
            <h3>릴리즈노트</h3>
            <pre className="markdown-box">{note.notesMarkdown}</pre>
          </section>
        )}
        {note.entries.length > 0 && (
          <section className="drawer-section">
            <h3>작성 기록</h3>
            <div className="release-note-entry-list">
              {note.entries.map((entry, index) => (
                <article className="release-note-entry" key={entry.id}>
                  <div className="release-note-entry-header">
                    <div>
                      <strong>{entry.title ?? `${labelForTrigger(entry.trigger)} 작성 #${note.entries.length - index}`}</strong>
                      <span>
                        {labelForTrigger(entry.trigger)} · {labelForStatus(entry.status)} ·{" "}
                        {entry.generatedAt ? new Date(entry.generatedAt).toLocaleString() : new Date(entry.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <span className={`status ${statusClass(entry.status)}`}>{labelForStatus(entry.status)}</span>
                  </div>
                  {entry.errorMessage && <pre className="error-box">{entry.errorMessage}</pre>}
                  {entry.notesMarkdown && <pre className="markdown-box">{entry.notesMarkdown}</pre>}
                </article>
              ))}
            </div>
          </section>
        )}
        <div className="button-row">
          {externalUrl && (
            <a className="button secondary full" href={externalUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} />
              {note.releaseUrl ? "릴리즈 열기" : "태그 열기"}
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}

function labelForStatus(status: string): string {
  switch (status) {
    case "queued":
      return "대기 중";
    case "running":
      return "작성 중";
    case "completed":
      return "완료";
    case "failed":
      return "실패";
    default:
      return status;
  }
}

function statusClass(status: string): string {
  switch (status) {
    case "queued":
    case "running":
      return "warn";
    case "completed":
      return "ok";
    case "failed":
      return "bad";
    default:
      return "muted";
  }
}

function hasActiveNotes(notes: ReleaseNote[]): boolean {
  return notes.some((note) => note.status === "queued" || note.status === "running" || note.entries.some((entry) => entry.status === "queued" || entry.status === "running"));
}

function isActiveStatus(status: string | null): boolean {
  return status === "queued" || status === "running";
}

function labelForTrigger(trigger: string): string {
  if (trigger === "manual") return "수동";
  if (trigger === "webhook") return "자동";
  return trigger;
}
