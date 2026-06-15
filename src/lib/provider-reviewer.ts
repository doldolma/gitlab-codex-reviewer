import type { CodexReviewModelSettings, CodexReviewRuntimeSettings } from "./codex-review-settings";
import type { ReviewPromptInput } from "./prompts";
import type { ReviewEngineEvent, ReviewResult, Reviewer } from "./review-engine";
import type { ReviewTriageInput, ReviewTriageResult, ReviewTriageRunner } from "./review-triage";
import type { ReleaseNoteEngineEvent, ReleaseNoteResult, ReleaseNoteWriter } from "./release-note-engine";
import type { ReleaseNotePromptInput } from "./release-note-prompts";

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

/** Dispatches triage to the codex or OpenAI-compatible engine by provider. */
export class ProviderTriageRunner implements ReviewTriageRunner {
  constructor(
    private readonly codexTriage: ReviewTriageRunner,
    private readonly compatibleTriage: ReviewTriageRunner
  ) {}

  triage(
    input: ReviewTriageInput,
    settings: CodexReviewModelSettings,
    options?: { signal?: AbortSignal }
  ): Promise<ReviewTriageResult> {
    const runner = settings.provider === "openai_compatible" ? this.compatibleTriage : this.codexTriage;
    return runner.triage(input, settings, options);
  }
}

/** Dispatches release-note generation to the codex or OpenAI-compatible engine by provider. */
export class ProviderReleaseNoteWriter implements ReleaseNoteWriter {
  constructor(
    private readonly codexWriter: ReleaseNoteWriter,
    private readonly compatibleWriter: ReleaseNoteWriter
  ) {}

  write(
    input: ReleaseNotePromptInput,
    onEvent?: (event: ReleaseNoteEngineEvent) => Promise<void> | void,
    settings?: CodexReviewRuntimeSettings,
    options?: { signal?: AbortSignal }
  ): Promise<ReleaseNoteResult> {
    const writer = settings?.provider === "openai_compatible" ? this.compatibleWriter : this.codexWriter;
    return writer.write(input, onEvent, settings, options);
  }
}
