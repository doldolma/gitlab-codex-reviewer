import type { CodexReviewRuntimeSettings } from "./codex-review-settings";
import type { ReviewPromptInput } from "./prompts";
import type { ReviewEngineEvent, ReviewResult, Reviewer } from "./review-engine";

/**
 * Dispatches a review to the codex agent or the direct OpenAI-compatible agent
 * based on the configured provider. The worker stays unaware of the backend.
 */
export class ProviderReviewer implements Reviewer {
  constructor(
    private readonly codexReviewer: Reviewer,
    private readonly compatibleReviewer: Reviewer
  ) {}

  review(
    input: ReviewPromptInput,
    onEvent?: (event: ReviewEngineEvent) => Promise<void> | void,
    settings?: CodexReviewRuntimeSettings,
    options?: { signal?: AbortSignal }
  ): Promise<ReviewResult> {
    const reviewer = settings?.provider === "openai_compatible" ? this.compatibleReviewer : this.codexReviewer;
    return reviewer.review(input, onEvent, settings, options);
  }
}
