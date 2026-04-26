import type { ReviewEventLevel, ReviewRunType } from "./review-state";

export type ReviewLogSource = "web" | "worker";

export type ReviewLogContext = {
  source: ReviewLogSource;
  runType?: ReviewRunType;
  runId?: number;
  project?: string | number | null;
  sha?: string | null;
  step?: string;
  metadata?: Record<string, unknown>;
};

export function logReview(level: ReviewEventLevel, message: string, context: ReviewLogContext): void {
  const payload = cleanLogPayload({
    source: context.source,
    runType: context.runType,
    runId: context.runId,
    project: context.project,
    sha: context.sha ? shortSha(context.sha) : undefined,
    step: context.step,
    ...(context.metadata ?? {})
  });
  const line = `[${context.source}] [review] ${message} ${JSON.stringify(payload)}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export function logWorker(level: ReviewEventLevel, message: string, metadata: Record<string, unknown> = {}): void {
  const line = `[worker] [review] ${message} ${JSON.stringify(cleanLogPayload(metadata))}`;
  if (level === "error") {
    console.error(line);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

function shortSha(value: string): string {
  return value.length > 12 ? value.slice(0, 12) : value;
}

function cleanLogPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined && value !== null));
}
