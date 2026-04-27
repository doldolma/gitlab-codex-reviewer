import { describe, expect, it } from "vitest";
import { commitReviewExternalLink } from "../lib/review-links";

describe("commit review external links", () => {
  it("opens the review comment before the commit page when both links exist", () => {
    expect(
      commitReviewExternalLink({
        commentUrl: "https://gitlab.example.com/group/project/-/commit/abc123#note_42",
        commitUrl: "https://gitlab.example.com/group/project/-/commit/abc123"
      })
    ).toEqual({
      href: "https://gitlab.example.com/group/project/-/commit/abc123#note_42",
      title: "리뷰 댓글 열기"
    });
  });

  it("falls back to the commit page when the review comment link is absent", () => {
    expect(
      commitReviewExternalLink({
        commentUrl: null,
        commitUrl: "https://gitlab.example.com/group/project/-/commit/abc123"
      })
    ).toEqual({
      href: "https://gitlab.example.com/group/project/-/commit/abc123",
      title: "커밋 열기"
    });
  });

  it("omits the external link when neither URL exists", () => {
    expect(commitReviewExternalLink({ commentUrl: null, commitUrl: null })).toBeNull();
  });
});
