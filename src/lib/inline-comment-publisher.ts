import { createHash } from "node:crypto";
import type { GitLabClient, GitLabDiff, GitLabMergeRequest } from "./gitlab-client";
import type { ReviewIssue } from "./prompts";

const INLINE_MARKER_PREFIX = "<!-- gitlab-codex-reviewer-inline";

export type InlineCommentResult = {
  issueFingerprint: string;
  file: string;
  line: number;
  status: "posted" | "skipped_existing" | "failed" | "skipped_no_position";
  discussionId: string | null;
  error: string | null;
};

export async function publishMergeRequestInlineComments(
  client: GitLabClient,
  projectId: string,
  mrIid: number,
  headSha: string,
  mr: GitLabMergeRequest,
  diffs: GitLabDiff[],
  issues: ReviewIssue[]
): Promise<InlineCommentResult[]> {
  const refs = mr.diff_refs;
  if (!refs?.base_sha || !refs.start_sha || !refs.head_sha) {
    return inlineIssues(issues).map((issue) => ({
      issueFingerprint: fingerprintIssue(headSha, issue),
      file: issue.file!,
      line: issue.line!,
      status: "failed",
      discussionId: null,
      error: "GitLab diff refs are missing"
    }));
  }

  const discussions = await client.listMergeRequestDiscussions(projectId, mrIid);
  const existingBodies = discussions.flatMap((discussion) => discussion.notes.map((note) => note.body));

  const results: InlineCommentResult[] = [];
  for (const issue of inlineIssues(issues)) {
    const fingerprint = fingerprintIssue(headSha, issue);
    const marker = inlineMarker(headSha, fingerprint);
    if (existingBodies.some((body) => body.includes(marker))) {
      results.push({ issueFingerprint: fingerprint, file: issue.file!, line: issue.line!, status: "skipped_existing", discussionId: null, error: null });
      continue;
    }

    const diff = findDiffForIssue(diffs, issue.file!);
    if (!diff) {
      results.push({ issueFingerprint: fingerprint, file: issue.file!, line: issue.line!, status: "skipped_no_position", discussionId: null, error: "Changed file was not found in the diff" });
      continue;
    }

    try {
      const discussion = await client.createMergeRequestDiscussion(projectId, mrIid, {
        body: buildInlineCommentBody(headSha, fingerprint, issue),
        baseSha: refs.base_sha,
        startSha: refs.start_sha,
        headSha: refs.head_sha,
        oldPath: diff.old_path,
        newPath: diff.new_path,
        newLine: issue.line!
      });
      results.push({ issueFingerprint: fingerprint, file: issue.file!, line: issue.line!, status: "posted", discussionId: discussion.id, error: null });
    } catch (error) {
      results.push({
        issueFingerprint: fingerprint,
        file: issue.file!,
        line: issue.line!,
        status: "failed",
        discussionId: null,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
  return results;
}

export function fingerprintIssue(headSha: string, issue: ReviewIssue): string {
  return createHash("sha256")
    .update([headSha, issue.category, issue.severity, issue.file ?? "", issue.line ?? "", issue.title].join("\0"))
    .digest("hex")
    .slice(0, 16);
}

function inlineIssues(issues: ReviewIssue[]): ReviewIssue[] {
  return issues.filter((issue) => Boolean(issue.file) && typeof issue.line === "number" && issue.line > 0).slice(0, 20);
}

function inlineMarker(headSha: string, fingerprint: string): string {
  return `${INLINE_MARKER_PREFIX} sha=${headSha} fp=${fingerprint} -->`;
}

function buildInlineCommentBody(headSha: string, fingerprint: string, issue: ReviewIssue): string {
  return [
    inlineMarker(headSha, fingerprint),
    "",
    `**${severityLabel(issue.severity)} ${issue.title}**`,
    "",
    `- 분류: \`${issue.category}\``,
    `- 신뢰도: ${Math.round(issue.confidence * 100)}%`,
    `- 영향: ${issue.impact}`,
    `- 권장 조치: ${issue.recommendation}`,
    "",
    issue.details
  ].join("\n");
}

function findDiffForIssue(diffs: GitLabDiff[], file: string): GitLabDiff | null {
  const normalized = normalizePath(file);
  return diffs.find((diff) => normalizePath(diff.new_path) === normalized || normalizePath(diff.old_path) === normalized) ?? null;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function severityLabel(value: string): string {
  if (value === "critical") return ":rotating_light:";
  if (value === "high") return ":warning:";
  if (value === "medium") return ":small_orange_diamond:";
  return ":small_blue_diamond:";
}
