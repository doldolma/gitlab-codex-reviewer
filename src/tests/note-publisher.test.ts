import { describe, expect, it } from "vitest";
import {
  hasCommitMarker,
  hasMarker,
  markerForCommitSha,
  markerForSha,
  publishCommitReviewNote,
  publishReviewNote
} from "../lib/note-publisher";
import type { GitLabClient } from "../lib/gitlab-client";

describe("review note marker", () => {
  it("detects markers for a reviewed SHA", () => {
    const marker = markerForSha("abc123");
    expect(hasMarker(`body\n${marker}`, "abc123")).toBe(true);
    expect(hasMarker(`body\n${marker}`, "def456")).toBe(false);
  });

  it("detects markers for a reviewed commit SHA", () => {
    const marker = markerForCommitSha("abc123");
    expect(hasCommitMarker(`body\n${marker}`, "abc123")).toBe(true);
    expect(hasCommitMarker(`body\n${marker}`, "def456")).toBe(false);
  });

  it("builds a merge request note deep link from the note id", async () => {
    const client = {
      async listMergeRequestNotes() {
        return [];
      },
      async createMergeRequestNote() {
        return { id: 42, body: "review" };
      }
    } as unknown as GitLabClient;

    const note = await publishReviewNote(
      client,
      "group/project",
      7,
      "abc123",
      "review markdown",
      "https://gitlab.example.com/group/project/-/merge_requests/7"
    );

    expect(note).toEqual({
      id: 42,
      url: "https://gitlab.example.com/group/project/-/merge_requests/7#note_42",
      skipped: false
    });
  });

  it("reuses an existing merge request note marker and deep link", async () => {
    const client = {
      async listMergeRequestNotes() {
        return [{ id: 99, body: `old review\n${markerForSha("abc123")}` }];
      },
      async createMergeRequestNote() {
        throw new Error("should not create a duplicate note");
      }
    } as unknown as GitLabClient;

    const note = await publishReviewNote(
      client,
      "group/project",
      7,
      "abc123",
      "review markdown",
      "https://gitlab.example.com/group/project/-/merge_requests/7"
    );

    expect(note).toEqual({
      id: 99,
      url: "https://gitlab.example.com/group/project/-/merge_requests/7#note_99",
      skipped: true
    });
  });

  it("finds the created commit comment through discussions and links to its note anchor", async () => {
    const calls: string[] = [];
    const client = {
      async listCommitDiscussions() {
        calls.push("list");
        if (calls.length === 1) return [];
        return [
          {
            id: "discussion-1",
            notes: [{ id: 123, body: `created review\n${markerForCommitSha("abc123")}` }]
          }
        ];
      },
      async createCommitComment() {
        calls.push("create");
        return { note: "created review" };
      }
    } as unknown as GitLabClient;

    const note = await publishCommitReviewNote(
      client,
      "group/project",
      "abc123",
      "review markdown",
      "https://gitlab.example.com/group/project/-/commit/abc123"
    );

    expect(calls).toEqual(["list", "create", "list"]);
    expect(note).toEqual({
      id: 123,
      url: "https://gitlab.example.com/group/project/-/commit/abc123#note_123",
      skipped: false
    });
  });

  it("reuses an existing commit discussion marker without creating a duplicate comment", async () => {
    const client = {
      async listCommitDiscussions() {
        return [
          {
            id: "discussion-1",
            notes: [{ id: 456, body: `old review\n${markerForCommitSha("abc123")}` }]
          }
        ];
      },
      async createCommitComment() {
        throw new Error("should not create a duplicate comment");
      }
    } as unknown as GitLabClient;

    const note = await publishCommitReviewNote(
      client,
      "group/project",
      "abc123",
      "review markdown",
      "https://gitlab.example.com/group/project/-/commit/abc123"
    );

    expect(note).toEqual({
      id: 456,
      url: "https://gitlab.example.com/group/project/-/commit/abc123#note_456",
      skipped: true
    });
  });

  it("falls back to a null commit comment link when GitLab does not expose a note id", async () => {
    const calls: string[] = [];
    const client = {
      async listCommitDiscussions() {
        calls.push("list");
        if (calls.length === 1) return [];
        return [
          {
            id: "discussion-1",
            notes: [{ body: `review without id\n${markerForCommitSha("abc123")}` }]
          }
        ];
      },
      async createCommitComment() {
        calls.push("create");
        return { note: "created review" };
      }
    } as unknown as GitLabClient;

    const note = await publishCommitReviewNote(
      client,
      "group/project",
      "abc123",
      "review markdown",
      "https://gitlab.example.com/group/project/-/commit/abc123"
    );

    expect(calls).toEqual(["list", "create", "list"]);
    expect(note).toEqual({
      id: null,
      url: null,
      skipped: false
    });
  });

  it("does not duplicate an existing commit marker when the note id is missing", async () => {
    const client = {
      async listCommitDiscussions() {
        return [
          {
            id: "discussion-1",
            notes: [{ body: `old review without id\n${markerForCommitSha("abc123")}` }]
          }
        ];
      },
      async createCommitComment() {
        throw new Error("should not create a duplicate comment");
      }
    } as unknown as GitLabClient;

    const note = await publishCommitReviewNote(
      client,
      "group/project",
      "abc123",
      "review markdown",
      "https://gitlab.example.com/group/project/-/commit/abc123"
    );

    expect(note).toEqual({
      id: null,
      url: null,
      skipped: true
    });
  });
});
