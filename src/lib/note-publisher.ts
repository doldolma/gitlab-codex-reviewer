import type { GitLabClient } from "./gitlab-client";

const MARKER_PREFIX = "<!-- gitlab-codex-reviewer";

export function markerForSha(sha: string): string {
  return `${MARKER_PREFIX} sha=${sha} -->`;
}

export function markerForCommitSha(sha: string): string {
  return `${MARKER_PREFIX} commit-sha=${sha} -->`;
}

export function hasMarker(body: string, sha: string): boolean {
  return body.includes(markerForSha(sha));
}

export function hasCommitMarker(body: string, sha: string): boolean {
  return body.includes(markerForCommitSha(sha));
}

export function buildReviewNote(sha: string, markdown: string): string {
  return `${markerForSha(sha)}\n\n${markdown.trim()}\n`;
}

export function buildCommitReviewNote(sha: string, markdown: string): string {
  return `${markerForCommitSha(sha)}\n\n${markdown.trim()}\n`;
}

export async function publishReviewNote(
  client: GitLabClient,
  projectId: string,
  mrIid: number,
  sha: string,
  markdown: string
): Promise<{ id: number; url: string | null; skipped: boolean }> {
  const notes = await client.listMergeRequestNotes(projectId, mrIid);
  const existing = notes.find((note) => hasMarker(note.body, sha));
  if (existing) {
    return { id: existing.id, url: existing.web_url ?? null, skipped: true };
  }

  const created = await client.createMergeRequestNote(projectId, mrIid, buildReviewNote(sha, markdown));
  return { id: created.id, url: created.web_url ?? null, skipped: false };
}

export async function publishCommitReviewNote(
  client: GitLabClient,
  projectId: string,
  sha: string,
  markdown: string
): Promise<{ id: number | null; url: string | null; skipped: boolean }> {
  const comments = await client.listCommitComments(projectId, sha);
  const existing = comments.find((comment) => hasCommitMarker(comment.note, sha));
  if (existing) {
    return { id: existing.id ?? null, url: existing.web_url ?? null, skipped: true };
  }

  const created = await client.createCommitComment(projectId, sha, buildCommitReviewNote(sha, markdown));
  return { id: created.id ?? null, url: created.web_url ?? null, skipped: false };
}
