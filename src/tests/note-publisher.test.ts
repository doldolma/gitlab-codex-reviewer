import { describe, expect, it } from "vitest";
import { hasCommitMarker, hasMarker, markerForCommitSha, markerForSha } from "../lib/note-publisher";

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
});
