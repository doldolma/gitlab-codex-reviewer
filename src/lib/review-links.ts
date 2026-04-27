export type ExternalReviewLink = {
  href: string;
  title: string;
};

export function commitReviewExternalLink(review: { commentUrl: string | null; commitUrl: string | null }): ExternalReviewLink | null {
  if (review.commentUrl) {
    return {
      href: review.commentUrl,
      title: "리뷰 댓글 열기"
    };
  }
  if (review.commitUrl) {
    return {
      href: review.commitUrl,
      title: "커밋 열기"
    };
  }
  return null;
}
