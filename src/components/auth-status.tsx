import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Copy, ExternalLink, GitBranch, KeyRound, LogOut, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { apiGet, apiSend, type AuthStatus, type CodexLoginStart, type CodexStatus, type ReviewerBotStatus } from "../lib/api-client";

export function AuthStatusPanel() {
  const queryClient = useQueryClient();
  const loginPollRef = useRef<number | null>(null);
  const [deviceLogin, setDeviceLogin] = useState<Extract<CodexLoginStart, { type: "device" }> | null>(null);
  const auth = useQuery({ queryKey: ["auth-status"], queryFn: () => apiGet<AuthStatus>("/api/auth/status") });
  const codex = useQuery({ queryKey: ["codex-status"], queryFn: () => apiGet<CodexStatus>("/api/codex/status"), retry: false });
  const reviewerBot = useQuery({ queryKey: ["reviewer-bot-status"], queryFn: () => apiGet<ReviewerBotStatus>("/api/reviewer-bot/status") });
  const isAdmin = auth.data?.currentUser?.role === "admin";
  const codexAccountDetail = codex.data?.authenticated
    ? `인스턴스 공용 ${codex.data.planType ?? "Codex 계정"}`
    : codex.data?.error ?? "인스턴스 공용 ChatGPT 로그인이 필요합니다";

  useEffect(() => {
    if (codex.data?.authenticated) setDeviceLogin(null);
  }, [codex.data?.authenticated]);

  useEffect(() => {
    return () => {
      if (loginPollRef.current) window.clearInterval(loginPollRef.current);
    };
  }, []);

  const startCodexStatusPolling = () => {
    if (loginPollRef.current) window.clearInterval(loginPollRef.current);

    let attempts = 0;
    loginPollRef.current = window.setInterval(() => {
      attempts += 1;
      void queryClient
        .fetchQuery({
          queryKey: ["codex-status"],
          queryFn: () => apiGet<CodexStatus>("/api/codex/status")
        })
        .then((status) => {
          if (status.authenticated || attempts >= 60) {
            if (loginPollRef.current) window.clearInterval(loginPollRef.current);
            loginPollRef.current = null;
            if (status.authenticated) setDeviceLogin(null);
          }
        });
    }, 2000);
  };

  const startCodexLogin = useMutation({
    mutationFn: () =>
      apiSend<CodexLoginStart>("/api/codex/login/start", {
        method: "POST",
        body: JSON.stringify({ mode: "device" })
      }),
    onSuccess: (data) => {
      if (data.type === "browser") {
        window.open(data.authUrl, "_blank", "noopener,noreferrer");
      } else {
        setDeviceLogin(data);
        window.open(data.verificationUrl, "_blank", "noopener,noreferrer");
      }
      startCodexStatusPolling();
    }
  });

  const disconnectCodex = useMutation({
    mutationFn: () => apiSend("/api/codex/logout", { method: "POST" }),
    onSuccess: () => {
      setDeviceLogin(null);
      void queryClient.invalidateQueries({ queryKey: ["codex-status"] });
    }
  });

  const copyDeviceCode = () => {
    if (!deviceLogin) return;
    void navigator.clipboard?.writeText(deviceLogin.userCode);
  };

  return (
    <section className="panel auth-grid">
      <div className="auth-item">
        <div className="auth-icon gitlab">
          <GitBranch size={20} />
        </div>
        <div>
          <span className="eyebrow">GitLab</span>
          <strong>{auth.data?.gitlab?.username ?? "연결되지 않음"}</strong>
          <p>{auth.data?.gitlab?.gitlabHost ?? "OAuth 연결이 필요합니다"}</p>
        </div>
      </div>

      <div className="auth-item">
        <div className="auth-icon codex">
          <Bot size={20} />
        </div>
        <div>
          <span className="eyebrow">Reviewer Bot</span>
          <strong>{reviewerBot.data?.connected ? reviewerBot.data.name ?? reviewerBot.data.username : "연결되지 않음"}</strong>
          <p>{reviewerBot.data?.connected ? reviewerBot.data.username : "Settings에서 연결할 수 있습니다"}</p>
        </div>
      </div>

      <div className="auth-item">
        <div className="auth-icon codex">
          <KeyRound size={20} />
        </div>
        <div>
          <span className="eyebrow">Codex</span>
          <strong>{codex.data?.authenticated ? (isAdmin ? codex.data.email ?? "연결됨" : "연결됨") : "연결되지 않음"}</strong>
          {isAdmin && <p>{codexAccountDetail}</p>}
          <div className="review-meta-summary auth-meta">
            <span>{codex.data?.reviewModel ?? "gpt-5.5"}</span>
            <span>프로젝트별 전략</span>
          </div>
          {isAdmin && deviceLogin && !codex.data?.authenticated && (
            <div className="device-login-card">
              <span>Codex device code</span>
              <strong>{deviceLogin.userCode}</strong>
              <p>OpenAI 인증 페이지에 이 코드를 입력하면 Docker 환경에서도 연결됩니다.</p>
              <p className="device-login-note">ChatGPT 보안 설정에서 Codex용 장치 코드 인증이 켜져 있어야 합니다.</p>
              <div className="button-row">
                <a className="button secondary small" href={deviceLogin.verificationUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} />
                  인증 페이지
                </a>
                <button className="button secondary small" type="button" onClick={copyDeviceCode}>
                  <Copy size={14} />
                  코드 복사
                </button>
              </div>
            </div>
          )}
        </div>
        {isAdmin && (
          <div className="button-row">
            <button className="icon-button" onClick={() => codex.refetch()} title="Codex 상태 새로고침">
              <RefreshCw size={16} />
            </button>
            {codex.data?.authenticated ? (
              <button
                className="icon-button danger"
                onClick={() => disconnectCodex.mutate()}
                disabled={disconnectCodex.isPending}
                title="Codex 연결 해제"
              >
                <LogOut size={16} />
              </button>
            ) : (
              <button className="button" onClick={() => startCodexLogin.mutate()} disabled={startCodexLogin.isPending}>
                <ExternalLink size={16} />
                연결
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
