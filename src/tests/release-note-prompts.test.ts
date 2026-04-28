import { describe, expect, it } from "vitest";
import { buildReleaseNotePrompt, parseStructuredReleaseNote, renderReleaseNoteMarkdown } from "../lib/release-note-prompts";

describe("release note prompts", () => {
  it("builds a Korean user-facing release note prompt", () => {
    const prompt = buildReleaseNotePrompt({
      projectName: "Group / Product",
      tagName: "v1.2.0",
      previousTagName: "v1.1.0",
      commitCount: 2,
      commits: [
        { id: "abc123", title: "Improve dashboard loading" },
        { id: "def456", title: "Fix login redirect" }
      ],
      diffText: "diff --git a/app.ts b/app.ts",
      diffTruncated: false,
      omittedFiles: 0,
      workingDirectory: "/workspaces/product",
      changedFiles: ["app.ts"],
      domainContext: "사용자는 입찰 운영 담당자이며 정산 정확도를 중요하게 봅니다."
    });

    expect(prompt).toContain("product release note writer");
    expect(prompt).toContain("개발자가 아닌");
    expect(prompt).toContain("v1.1.0부터 v1.2.0까지");
    expect(prompt).toContain("Improve dashboard loading");
    expect(prompt).toContain("read-only tools");
    expect(prompt).toContain("Do not run tests");
    expect(prompt).toContain("app.ts");
    expect(prompt).toContain("Domain Context");
    expect(prompt).toContain("정산 정확도");
    expect(prompt).toContain("Do not invent features or behavior");
  });

  it("renders structured release notes as markdown", () => {
    const structured = parseStructuredReleaseNote(JSON.stringify({
      releaseLanguage: "ko-KR",
      title: "v1.2.0 릴리즈",
      overview: "사용자가 더 빠르게 작업을 확인할 수 있는 업데이트입니다.",
      highlights: ["대시보드가 더 빠르게 열립니다."],
      improvements: ["로그인 후 이동 흐름이 자연스러워졌습니다."],
      fixes: ["특정 조건에서 화면이 비어 보이던 문제가 수정되었습니다."],
      upgradeNotes: [],
      knownLimitations: [],
      closingNote: "안정적인 사용을 위해 최신 버전으로 업데이트하세요."
    }));

    const markdown = renderReleaseNoteMarkdown(structured);

    expect(markdown).toContain("# v1.2.0 릴리즈");
    expect(markdown).toContain("## 주요 변화");
    expect(markdown).not.toContain("## 업데이트 전 확인");
  });
});
