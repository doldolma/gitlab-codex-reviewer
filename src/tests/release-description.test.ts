import { describe, expect, it } from "vitest";
import { composeGitLabReleaseDescription } from "../lib/release-description";

describe("GitLab release description composition", () => {
  it("replaces app-managed release note blocks instead of appending repeatedly", () => {
    const existing = [
      "수동으로 적은 운영 메모",
      "",
      "<!-- gitlab-codex-reviewer:release-notes:start -->",
      "",
      "## 추가 릴리즈노트 (수동 작성, 2026-04-28T00:00:00.000Z)",
      "",
      "# old",
      "",
      "<!-- gitlab-codex-reviewer:release-notes:end -->"
    ].join("\n");

    const next = composeGitLabReleaseDescription(existing, "# new", "manual", "v1.2.0", "2026-04-28T01:00:00.000Z");

    expect(next).toContain("수동으로 적은 운영 메모");
    expect(next).toContain("# new");
    expect(next).not.toContain("# old");
    expect((next.match(/gitlab-codex-reviewer:release-notes:start/g) ?? [])).toHaveLength(1);
  });

  it("removes the legacy appended section that was produced before managed blocks existed", () => {
    const existing = [
      "# v1.2.0 릴리즈 노트",
      "",
      "## 주요 변화",
      "- 기존 내용",
      "",
      "## 개선 사항",
      "- 기존 개선",
      "",
      "## 수정 사항",
      "- 기존 수정",
      "",
      "---",
      "",
      "## 추가 릴리즈노트 (수동 작성, 2026-04-28T04:07:13.746Z)",
      "",
      "# duplicated"
    ].join("\n");

    const next = composeGitLabReleaseDescription(existing, "# v1.2.0 릴리즈 노트\n\n## 주요 변화\n- 새 내용", "manual", "v1.2.0");

    expect(next).toContain("새 내용");
    expect(next).not.toContain("duplicated");
    expect(next).not.toContain("기존 내용");
  });
});
