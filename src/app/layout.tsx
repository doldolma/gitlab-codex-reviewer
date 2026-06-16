import type { Metadata } from "next";
import "./globals.css";
import { QueryProvider } from "../components/query-provider";
import { APP_NAME } from "../lib/branding";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "GitLab merge request와 commit review를 관리하는 개인 리뷰 콘솔"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
