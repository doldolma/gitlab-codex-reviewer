"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useEffect } from "react";
import { GitCommit, GitMerge, LayoutDashboard, LogOut, Newspaper, Settings, ShieldCheck } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiSend, type AuthStatus } from "../lib/api-client";
import { APP_NAME } from "../lib/branding";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => apiGet<AuthStatus>("/api/auth/status")
  });
  const signOut = useMutation({
    mutationFn: () => apiSend("/api/auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      window.location.assign("/login");
    }
  });

  useEffect(() => {
    if (auth.data && !auth.data.authenticated) {
      router.replace(`/login?redirectTo=${encodeURIComponent(pathname || "/")}`);
    }
  }, [auth.data, pathname, router]);

  if (auth.isLoading) return <div className="center-screen">불러오는 중</div>;
  if (!auth.data?.authenticated) return <div className="center-screen">로그인 화면으로 이동 중</div>;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck size={22} />
          <div>
            <strong>{APP_NAME}</strong>
            <span>
              {auth.data.currentUser?.username} · {auth.data.currentUser?.role === "admin" ? "관리자" : "사용자"}
            </span>
          </div>
        </div>
        <nav>
          <NavItem href="/" icon={<LayoutDashboard size={18} />} label="Dashboard" active={pathname === "/"} />
          <NavItem href="/projects" icon={<GitMerge size={18} />} label="Projects" active={pathname === "/projects"} />
          <NavItem
            href="/merge-requests"
            icon={<GitMerge size={18} />}
            label="Merge Requests"
            active={pathname === "/merge-requests"}
          />
          <NavItem
            href="/commit-reviews"
            icon={<GitCommit size={18} />}
            label="Commit Reviews"
            active={pathname === "/commit-reviews"}
          />
          <NavItem
            href="/release-notes"
            icon={<Newspaper size={18} />}
            label="Release Notes"
            active={pathname === "/release-notes"}
          />
          <NavItem href="/settings" icon={<Settings size={18} />} label="Settings" active={pathname === "/settings"} />
        </nav>
        <div className="sidebar-footer">
          <button className="sidebar-signout" type="button" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
            <LogOut size={18} />
            <span>로그아웃</span>
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>
    </div>
  );
}

function NavItem({
  href,
  icon,
  label,
  active
}: {
  href: string;
  icon: ReactNode;
  label: string;
  active: boolean;
}) {
  return (
    <Link href={href} className={active ? "active" : undefined}>
      {icon}
      <span>{label}</span>
    </Link>
  );
}
