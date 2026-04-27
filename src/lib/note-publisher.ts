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
  markdown: string,
  baseWebUrl?: string | null
): Promise<{ id: number; url: string | null; skipped: boolean }> {
  const notes = await client.listMergeRequestNotes(projectId, mrIid);
  const existing = notes.find((note) => hasMarker(note.body, sha));
  if (existing) {
    return { id: existing.id, url: commentUrl(baseWebUrl, existing.id, existing.web_url), skipped: true };
  }

  const created = await client.createMergeRequestNote(projectId, mrIid, buildReviewNote(sha, markdown));
  return { id: created.id, url: commentUrl(baseWebUrl, created.id, created.web_url), skipped: false };
}

export async function publishCommitReviewNote(
  client: GitLabClient,
  projectId: string,
  sha: string,
  markdown: string,
  baseWebUrl?: string | null
): Promise<{ id: number | null; url: string | null; skipped: boolean }> {
  const existing = await findCommitReviewNote(client, projectId, sha);
  if (existing) {
    return { id: existing.id, url: commentUrl(baseWebUrl, existing.id, existing.web_url), skipped: true };
  }

  await client.createCommitComment(projectId, sha, buildCommitReviewNote(sha, markdown));
  const created = await findCommitReviewNote(client, projectId, sha);
  return {
    id: created?.id ?? null,
    url: created ? commentUrl(baseWebUrl, created.id, created.web_url) : null,
    skipped: false
  };
}

async function findCommitReviewNote(
  client: GitLabClient,
  projectId: string,
  sha: string
): Promise<{ id: number | null; web_url?: string } | null> {
  const discussions = await client.listCommitDiscussions(projectId, sha);
  for (const discussion of discussions) {
    for (const note of discussion.notes) {
      if (hasCommitMarker(note.body, sha)) {
        return { id: parseNoteId(note), web_url: note.web_url };
      }
    }
  }
  return null;
}

function parseNoteId(note: { id?: unknown }): number | null {
  return typeof note.id === "number" && Number.isInteger(note.id) ? note.id : null;
}

function commentUrl(baseWebUrl: string | null | undefined, noteId: number | null, fallbackUrl?: string | null): string | null {
  if (noteId === null) return fallbackUrl ?? null;
  if (baseWebUrl) {
    try {
      const url = new URL(baseWebUrl);
      url.hash = `note_${noteId}`;
      return url.toString();
    } catch {
      const withoutHash = baseWebUrl.split("#")[0];
      return `${withoutHash}#note_${noteId}`;
    }
  }
  return fallbackUrl ?? null;
}
