"use client";

import { useQuery } from "@tanstack/react-query";
import { GitBranch, ShieldCheck } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { apiGet, type AuthStatus } from "../../lib/api-client";
import { APP_NAME } from "../../lib/branding";

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="center-screen">불러오는 중</div>}>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const params = useSearchParams();
  const error = params.get("error");
  const redirectTo = params.get("redirectTo") || "/";
  const auth = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => apiGet<AuthStatus>("/api/auth/status"),
    retry: false
  });

  useEffect(() => {
    if (auth.data?.authenticated) window.location.assign(redirectTo);
  }, [auth.data?.authenticated, redirectTo]);

  return (
    <div className="login-page">
      <section className="login-panel">
        <div className="login-mark">
          <ShieldCheck size={30} />
        </div>
        <h1>{APP_NAME}</h1>
        <p>GitLab MR과 커밋 리뷰를 관리하는 개인 리뷰 콘솔입니다.</p>
        {error && <div className="alert bad">{error}</div>}
        {auth.data?.oauthConfigured === false && (
          <div className="alert warn">GitLab OAuth 클라이언트 설정이 필요합니다.</div>
        )}
        <a className="button large full" href={`/api/auth/gitlab/start?redirectTo=${encodeURIComponent(redirectTo)}`}>
          <GitBranch size={18} />
          GitLab로 계속하기
        </a>
      </section>
    </div>
  );
}
