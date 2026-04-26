"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "../../components/app-shell";
import {
  apiGet,
  apiSend,
  type AdminUser,
  type AuthStatus,
  type CodexReviewSettings,
  type ReviewerBotStatus,
  type UserRole
} from "../../lib/api-client";

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const auth = useQuery({ queryKey: ["auth-status"], queryFn: () => apiGet<AuthStatus>("/api/auth/status") });
  const isAdmin = auth.data?.currentUser?.role === "admin";
  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiGet<{ users: AdminUser[] }>("/api/admin/users"),
    enabled: isAdmin
  });
  const [roleError, setRoleError] = useState<string | null>(null);
  const [botToken, setBotToken] = useState("");
  const [botError, setBotError] = useState<string | null>(null);
  const [reviewModel, setReviewModel] = useState("");
  const [reviewSettingsError, setReviewSettingsError] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const reviewerBot = useQuery({
    queryKey: ["reviewer-bot-status"],
    queryFn: () => apiGet<ReviewerBotStatus>("/api/reviewer-bot/status")
  });
  const reviewSettings = useQuery({
    queryKey: ["codex-review-settings"],
    queryFn: () => apiGet<CodexReviewSettings>("/api/codex/review-settings")
  });
  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: number; role: UserRole }) =>
      apiSend<{ user: AdminUser }>(`/api/admin/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role })
      }),
    onSuccess: () => {
      setRoleError(null);
      void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      void queryClient.invalidateQueries({ queryKey: ["auth-status"] });
    },
    onError: (error) => {
      setRoleError(error instanceof Error ? error.message : String(error));
    }
  });
  const connectBot = useMutation({
    mutationFn: () =>
      apiSend<ReviewerBotStatus>("/api/reviewer-bot/connect", {
        method: "POST",
        body: JSON.stringify({ token: botToken })
      }),
    onSuccess: () => {
      setBotToken("");
      setBotError(null);
      void queryClient.invalidateQueries({ queryKey: ["reviewer-bot-status"] });
    },
    onError: (error) => setBotError(error instanceof Error ? error.message : String(error))
  });
  const verifyBot = useMutation({
    mutationFn: () => apiSend<ReviewerBotStatus>("/api/reviewer-bot/verify", { method: "POST" }),
    onSuccess: () => {
      setBotError(null);
      void queryClient.invalidateQueries({ queryKey: ["reviewer-bot-status"] });
    },
    onError: (error) => setBotError(error instanceof Error ? error.message : String(error))
  });
  const disconnectBot = useMutation({
    mutationFn: () => apiSend("/api/reviewer-bot/disconnect", { method: "DELETE" }),
    onSuccess: () => {
      setBotError(null);
      void queryClient.invalidateQueries({ queryKey: ["reviewer-bot-status"] });
    },
    onError: (error) => setBotError(error instanceof Error ? error.message : String(error))
  });
  const updateReviewSettings = useMutation({
    mutationFn: () =>
      apiSend<CodexReviewSettings>("/api/codex/review-settings", {
        method: "PATCH",
        body: JSON.stringify({ model: reviewModel })
      }),
    onSuccess: () => {
      setReviewSettingsError(null);
      void queryClient.invalidateQueries({ queryKey: ["codex-review-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["codex-status"] });
    },
    onError: (error) => setReviewSettingsError(error instanceof Error ? error.message : String(error))
  });

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  useEffect(() => {
    if (!reviewSettings.data) return;
    setReviewModel(reviewSettings.data.model);
  }, [reviewSettings.data?.model]);

  const adminCount = users.data?.users.filter((user) => user.role === "admin").length ?? 0;

  return (
    <AppShell>
      <div className="page">
        <header className="page-header">
          <div>
            <span className="eyebrow">인스턴스</span>
            <h1>Settings</h1>
          </div>
        </header>
        <section className="panel settings-list">
          <div>
            <span>GitLab OAuth redirect URI</span>
            <code>{origin}/api/auth/gitlab/callback</code>
          </div>
          <div>
            <span>현재 GitLab 사용자</span>
            <code>
              {auth.data?.currentUser
                ? `${auth.data.currentUser.username} (${auth.data.currentUser.gitlabUserId}, ${roleLabel(auth.data.currentUser.role)})`
                : "로그인되지 않음"}
            </code>
          </div>
          <div>
            <span>GitLab host</span>
            <code>{auth.data?.gitlab?.gitlabHost ?? "연결되지 않음"}</code>
          </div>
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Codex</span>
              <h2>Codex Review</h2>
            </div>
          </div>
          {reviewSettingsError && <div className="alert bad">{reviewSettingsError}</div>}
          <div className="settings-list">
            <div>
              <span>현재 모델</span>
              <code>{reviewSettings.data?.model ?? "gpt-5.5"}</code>
            </div>
            <div>
              <span>리뷰 전략</span>
              <code>프로젝트별</code>
            </div>
            <div>
              <span>마지막 수정</span>
              <code>{formatOptionalDate(reviewSettings.data?.updatedAt)}</code>
            </div>
          </div>
          {isAdmin && (
            <div className="bot-token-form">
              <label>
                <span>모델</span>
                <input
                  list="codex-review-model-presets"
                  value={reviewModel}
                  onChange={(event) => setReviewModel(event.target.value)}
                  placeholder={reviewSettings.data?.defaults.model ?? "gpt-5.5"}
                />
                <datalist id="codex-review-model-presets">
                  {reviewSettings.data?.modelPresets.map((model) => (
                    <option key={model} value={model} />
                  ))}
                </datalist>
              </label>
              <div className="button-row">
                <button
                  className="button"
                  onClick={() => updateReviewSettings.mutate()}
                  disabled={updateReviewSettings.isPending || !reviewModel.trim()}
                >
                  설정 저장
                </button>
              </div>
            </div>
          )}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="eyebrow">자동화</span>
              <h2>Reviewer Bot</h2>
            </div>
          </div>
          {botError && <div className="alert bad">{botError}</div>}
          <div className="settings-list">
            <div>
              <span>상태</span>
              <code>
                {reviewerBot.data?.connected
                  ? `${reviewerBot.data.name ?? reviewerBot.data.username} (${reviewerBot.data.username})`
                  : "연결되지 않음"}
              </code>
            </div>
            <div>
              <span>마지막 검증</span>
              <code>{reviewerBot.data?.lastVerifiedAt ? new Date(reviewerBot.data.lastVerifiedAt).toLocaleString() : "없음"}</code>
            </div>
          </div>
          {isAdmin && (
            <div className="bot-token-form">
              <label>
                <span>Reviewer Bot Personal Access Token</span>
                <input
                  type="password"
                  value={botToken}
                  onChange={(event) => setBotToken(event.target.value)}
                  placeholder="glpat-..."
                />
              </label>
              <div className="button-row">
                <button className="button" onClick={() => connectBot.mutate()} disabled={connectBot.isPending || !botToken.trim()}>
                  토큰 저장
                </button>
                <button className="button secondary" onClick={() => verifyBot.mutate()} disabled={verifyBot.isPending || !reviewerBot.data?.connected}>
                  검증
                </button>
                <button
                  className="button secondary"
                  onClick={() => disconnectBot.mutate()}
                  disabled={disconnectBot.isPending || !reviewerBot.data?.connected}
                >
                  연결 해제
                </button>
              </div>
            </div>
          )}
        </section>

        {isAdmin && (
          <section className="panel">
            <div className="section-heading">
              <div>
                <span className="eyebrow">접근 권한</span>
                <h2>사용자</h2>
              </div>
            </div>
            {roleError && <div className="alert bad">{roleError}</div>}
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>사용자</th>
                    <th>GitLab</th>
                    <th>역할</th>
                    <th>수정일</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.data?.users.map((user) => {
                    const demotesLastAdmin = user.role === "admin" && adminCount <= 1;
                    const nextRole = user.role === "admin" ? "user" : "admin";
                    return (
                      <tr key={user.id}>
                        <td>
                          <strong>{user.username}</strong>
                          <span className="subtle">{user.name ?? "GitLab 사용자"}</span>
                        </td>
                        <td>
                          <span className="mono">{user.gitlabUserId}</span>
                          <span className="subtle">{user.gitlabHost}</span>
                        </td>
                        <td>
                          <span className={user.role === "admin" ? "status ok" : "status muted"}>{roleLabel(user.role)}</span>
                        </td>
                        <td>{new Date(user.updatedAt).toLocaleString()}</td>
                        <td className="right">
                          <button
                            className={user.role === "admin" ? "button secondary" : "button"}
                            onClick={() => setRole.mutate({ id: user.id, role: nextRole })}
                            disabled={setRole.isPending || demotesLastAdmin}
                            title={demotesLastAdmin ? "관리자는 최소 1명 필요합니다" : `${roleLabel(nextRole)}로 변경`}
                          >
                            {roleLabel(nextRole)}로 변경
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {!users.data?.users.length && (
                    <tr>
                      <td colSpan={5} className="empty">
                        사용자가 없습니다
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </AppShell>
  );
}

function roleLabel(role: UserRole): string {
  return role === "admin" ? "관리자" : "사용자";
}

function formatOptionalDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "기본값 사용";
}
