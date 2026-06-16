import { APP_NAME } from "./branding";
import type { GitLabCommit, GitLabDiff, GitLabMergeRequest } from "./gitlab-client";

export type FormattedDiff = {
  text: string;
  truncated: boolean;
  omittedFiles: number;
};

export function formatDiffForReview(
  projectDisplayName: string,
  mr: GitLabMergeRequest,
  diffs: GitLabDiff[],
  maxBytes: number
): FormattedDiff {
  const header = [
    `Project: ${projectDisplayName}`,
    `MR: !${mr.iid} ${mr.title}`,
    `URL: ${mr.web_url}`,
    `Head SHA: ${mr.sha ?? "unknown"}`,
    "",
    "Unified diff follows. Review only this diff; do not assume files outside it unless clearly implied.",
    ""
  ].join("\n");

  return formatDiffBody(header, diffs, maxBytes);
}

export function formatCommitDiffForReview(
  projectDisplayName: string,
  commit: GitLabCommit,
  branchName: string | null,
  diffs: GitLabDiff[],
  maxBytes: number
): FormattedDiff {
  const header = [
    `Project: ${projectDisplayName}`,
    `Commit: ${commit.id} ${commit.title ?? ""}`.trim(),
    branchName ? `Branch: ${branchName}` : null,
    commit.web_url ? `URL: ${commit.web_url}` : null,
    commit.author_name ? `Author: ${commit.author_name}` : null,
    commit.committed_date ? `Committed: ${commit.committed_date}` : null,
    "",
    "Unified diff follows. Review only this commit diff; do not assume files outside it unless clearly implied.",
    ""
  ]
    .filter((line): line is string => line !== null)
    .join("\n");

  return formatDiffBody(header, diffs, maxBytes);
}

function formatDiffBody(header: string, diffs: GitLabDiff[], maxBytes: number): FormattedDiff {
  let text = header;
  let truncated = false;
  let omittedFiles = 0;

  for (const file of diffs) {
    const flags = [
      file.new_file ? "new" : null,
      file.renamed_file ? "renamed" : null,
      file.deleted_file ? "deleted" : null,
      file.generated_file ? "generated" : null,
      file.collapsed ? "collapsed" : null,
      file.too_large ? "too_large" : null
    ].filter(Boolean);

    const chunk = [
      `diff --git a/${file.old_path} b/${file.new_path}`,
      flags.length ? `# GitLab flags: ${flags.join(", ")}` : null,
      file.diff,
      ""
    ]
      .filter((line): line is string => line !== null)
      .join("\n");

    if (Buffer.byteLength(text + chunk, "utf8") > maxBytes) {
      truncated = true;
      omittedFiles += 1;
      continue;
    }
    text += chunk;
  }

  if (truncated) {
    text += `\n# Diff truncated by ${APP_NAME}. Omitted files: ${omittedFiles}.\n`;
  }

  return { text, truncated, omittedFiles };
}
