import { describe, expect, it } from "vitest";
import { formatCommitDiffForReview, formatDiffForReview } from "../lib/diff-formatter";

describe("formatDiffForReview", () => {
  it("truncates diffs at the configured byte limit", () => {
    const result = formatDiffForReview(
      "Project",
      {
        iid: 1,
        title: "Test MR",
        web_url: "https://gitlab.example.com/mr/1",
        sha: "abc123",
        labels: [],
        draft: false,
        state: "opened",
        updated_at: new Date().toISOString()
      },
      [
        {
          old_path: "a.ts",
          new_path: "a.ts",
          new_file: false,
          renamed_file: false,
          deleted_file: false,
          diff: "@@ -1 +1 @@\n-a\n+b\n"
        },
        {
          old_path: "large.ts",
          new_path: "large.ts",
          new_file: false,
          renamed_file: false,
          deleted_file: false,
          diff: "x".repeat(1000)
        }
      ],
      420
    );

    expect(result.truncated).toBe(true);
    expect(result.omittedFiles).toBeGreaterThan(0);
    expect(result.text).toContain("Diff truncated");
  });

  it("formats commit diffs with commit metadata", () => {
    const result = formatCommitDiffForReview(
      "Project",
      {
        id: "abc123",
        title: "Fix bug",
        web_url: "https://gitlab.example.com/group/service/-/commit/abc123",
        author_name: "Alice",
        committed_date: "2026-04-26T00:00:00.000Z"
      },
      "main",
      [
        {
          old_path: "a.ts",
          new_path: "a.ts",
          new_file: false,
          renamed_file: false,
          deleted_file: false,
          diff: "@@ -1 +1 @@\n-a\n+b\n"
        }
      ],
      10_000
    );

    expect(result.text).toContain("Commit: abc123 Fix bug");
    expect(result.text).toContain("Branch: main");
    expect(result.truncated).toBe(false);
  });
});
