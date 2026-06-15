export const REVIEW_PROMPT_VERSION = "ko-workspace-review-v5";

export type ReviewPromptKind = "merge_request" | "commit";
export type ReviewAssessment = "safe" | "risky" | "needs_revision";
export type ReviewRiskLevel = "low" | "medium" | "high";
export type ReviewSeverity = "critical" | "high" | "medium" | "low";
export type ReviewCategory =
  | "bug"
  | "regression"
  | "security"
  | "data_loss"
  | "api_contract"
  | "concurrency"
  | "performance"
  | "testing"
  | "maintainability";

export type ReviewProfile = "chill" | "assertive";

export type ReviewIssue = {
  severity: ReviewSeverity;
  confidence: number;
  category: ReviewCategory;
  title: string;
  file: string | null;
  line: number | null;
  details: string;
  impact: string;
  recommendation: string;
};

export type ChangedFileSummary = {
  path: string;
  summary: string;
  riskLevel: ReviewRiskLevel;
};

export type ReviewEffort = {
  score: number;
  reason: string;
};

export type FlowSummaryStep = {
  step: string;
  actor: string;
  action: string;
  caution: string | null;
};

export type PromptToolFinding = {
  tool: string;
  severity: "info" | "low" | "medium" | "high";
  title: string;
  file: string | null;
  line: number | null;
  summary: string;
};

export type PromptReviewInstruction = {
  pathGlob: string;
  instructions: string;
  matchedFiles: string[];
};

export type StructuredReview = {
  reviewLanguage: "ko-KR";
  assessment: ReviewAssessment;
  changeIntent: string;
  reviewEffort: ReviewEffort;
  changedFilesSummary: ChangedFileSummary[];
  riskAreas: string[];
  summary: string[];
  criticalIssues: ReviewIssue[];
  potentialIssues: ReviewIssue[];
  suggestions: string[];
  testSuggestions: string[];
  notes: string[];
  flowSummary: FlowSummaryStep[];
  toolFindingsUsed: string[];
  confidenceReason: string;
  shouldPostComment: boolean;
  commentReason: string;
};

export type ReviewPromptInput = {
  kind: ReviewPromptKind;
  repoName: string;
  baseRef?: string | null;
  headRef?: string | null;
  sha: string;
  branchName?: string | null;
  diffText: string;
  workingDirectory?: string | null;
  changedFiles?: string[];
  matchedInstructions?: PromptReviewInstruction[];
  pathFilters?: string[];
  toolFindings?: PromptToolFinding[];
  reviewProfile?: ReviewProfile;
};

const issueSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    category: {
      type: "string",
      enum: ["bug", "regression", "security", "data_loss", "api_contract", "concurrency", "performance", "testing", "maintainability"]
    },
    title: { type: "string" },
    file: { type: ["string", "null"] },
    line: { type: ["number", "null"] },
    details: { type: "string" },
    impact: { type: "string" },
    recommendation: { type: "string" }
  },
  required: ["severity", "confidence", "category", "title", "file", "line", "details", "impact", "recommendation"]
} as const;

const changedFileSummarySchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    path: { type: "string" },
    summary: { type: "string" },
    riskLevel: { type: "string", enum: ["low", "medium", "high"] }
  },
  required: ["path", "summary", "riskLevel"]
} as const;

const flowSummaryStepSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    step: { type: "string" },
    actor: { type: "string" },
    action: { type: "string" },
    caution: { type: ["string", "null"] }
  },
  required: ["step", "actor", "action", "caution"]
} as const;

export const REVIEW_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewLanguage: { type: "string", enum: ["ko-KR"] },
    assessment: { type: "string", enum: ["safe", "risky", "needs_revision"] },
    changeIntent: { type: "string" },
    reviewEffort: {
      type: "object",
      additionalProperties: false,
      properties: {
        score: { type: "number", minimum: 1, maximum: 5 },
        reason: { type: "string" }
      },
      required: ["score", "reason"]
    },
    changedFilesSummary: { type: "array", items: changedFileSummarySchema },
    riskAreas: { type: "array", items: { type: "string" } },
    summary: { type: "array", items: { type: "string" } },
    criticalIssues: { type: "array", items: issueSchema },
    potentialIssues: { type: "array", items: issueSchema },
    suggestions: { type: "array", items: { type: "string" } },
    testSuggestions: { type: "array", items: { type: "string" } },
    notes: { type: "array", items: { type: "string" } },
    flowSummary: { type: "array", items: flowSummaryStepSchema },
    toolFindingsUsed: { type: "array", items: { type: "string" } },
    confidenceReason: { type: "string" },
    shouldPostComment: { type: "boolean" },
    commentReason: { type: "string" }
  },
  required: [
    "reviewLanguage",
    "assessment",
    "changeIntent",
    "reviewEffort",
    "changedFilesSummary",
    "riskAreas",
    "summary",
    "criticalIssues",
    "potentialIssues",
    "suggestions",
    "testSuggestions",
    "notes",
    "flowSummary",
    "toolFindingsUsed",
    "confidenceReason",
    "shouldPostComment",
    "commentReason"
  ]
} as const;

export function buildReviewPrompt(input: ReviewPromptInput): string {
  const reviewType = input.kind === "commit" ? "GitLab commit" : "GitLab Merge Request";
  const profile = input.reviewProfile ?? "assertive";
  const profileLine = profile === "chill"
    ? "Review profile: chill. Comment only on concrete correctness, security, data loss, or high-confidence regression risks. Keep maintainability suggestions conservative."
    : "Review profile: assertive. Explore broadly and flag meaningful maintainability, testing, performance, concurrency, and contract risks when evidence-backed.";
  const styleLine = profile === "chill"
    ? "- Be conservative and high-precision: minimize false positives. Only raise an issue when the risk is concrete and you are confident; when unsure, stay silent or use notes rather than criticalIssues or potentialIssues. Skip maintainability, style, and nice-to-have suggestions unless they carry real risk."
    : "- Be assertive and thorough: explore broadly and surface meaningful risks across correctness, security, performance, concurrency, error handling, and contracts — but only classify evidence-backed, actionable findings as issues.";
  const workspaceLine = input.workingDirectory
    ? "You are running inside the checked-out Git repository. Use read-only tools to inspect repository guidelines, changed files, callers, usages, schemas, contracts, configuration, and tests."
    : "A repository workspace is not available. Review only from the provided diff and explicitly note that repository exploration was unavailable.";

  return `SYSTEM:
You are a senior software engineer performing a professional, high-signal code review.

Your review language is fixed to Korean (ko-KR). Every human-readable JSON string you produce MUST be written in Korean. Keep file paths, function names, API names, schema names, error messages, and code identifiers in their original form.

Review style:
${styleLine}
- Focus on correctness, regressions, side effects, security, data loss, API/schema/contract compatibility, concurrency, error handling, performance, maintainability, and missing tests.
- Start by identifying the change intent and impact context. Explain what this commit or merge request is trying to change, not just which files changed.
- Avoid praise, generic advice, style-only comments, speculative concerns, and nitpicks.
- A finding must be supported by the diff or read-only repository exploration.
- If an issue is uncertain, put it in notes instead of criticalIssues or potentialIssues.
- Keep every human-readable field concise and table-friendly. Prefer short, evidence-backed sentences over long paragraphs.
- Do not produce Mermaid. GitLab Self-Managed may display Mermaid as a plain code block. Use flowSummary for runtime/API/event flows instead.

Tool policy:
- Use available read-only tools when needed to understand the codebase.
- Do not modify files.
- Do not run tests, package managers, network calls, build commands, migrations, formatters, generators, or any command with side effects.
- Prefer read-only commands: rg, git show, git diff, git status, sed, cat, ls, find.

${workspaceLine}

USER:

## Context
Repository: ${input.repoName}
Review type: ${reviewType}
Base: ${input.baseRef ?? "unknown"}
Head: ${input.headRef ?? "unknown"}
SHA: ${input.sha}
Branch: ${input.branchName ?? "unknown"}
Prompt version: ${REVIEW_PROMPT_VERSION}
${profileLine}

## Changed Files
${renderPromptList(input.changedFiles ?? [], "No changed file list was provided.")}

## App Path Filters
${renderPromptList(input.pathFilters ?? [], "No app-level path filters were configured.")}

## App Path Instructions
${renderPromptInstructions(input.matchedInstructions ?? [])}

## Static Analysis / Tool Findings
${renderPromptToolFindings(input.toolFindings ?? [])}

## Diff
\`\`\`diff
${input.diffText}
\`\`\`

## Required Review Process
Follow this process before producing the final JSON:
1. Understand the intent of the change from the diff and workspace context. Identify whether the main context is feature behavior, UI/UX, performance, reliability, operations, refactoring, API/schema contract, or tests.
2. Write changeIntent as one or two concise Korean sentences that explain the purpose and user/system impact of the change. If the purpose is not clear, do not guess; describe only the observable change and say the intent is not fully clear from the diff.
3. Produce a concise changed-files summary and estimate review effort from 1 to 5.
4. If a workspace exists, look for repository guidance such as AGENTS.md, README, CONTRIBUTING, .coderabbit.yaml/.coderabbit.yml, pull request templates, architecture notes, test docs, and config docs.
5. Inspect changed files and relevant surrounding code.
6. Use rg or similar read-only search to inspect callers, usages, API/schema/contract references, related tests, and configuration when relevant.
7. Check for bugs, regressions, security risks, data loss, API contract breaks, concurrency issues, error handling gaps, performance regressions, maintainability risks, and missing tests.
8. Review tool findings as leads, not as facts. Confirm each relevant tool finding by checking the diff or workspace before promoting it to an issue.
9. Respect app path filters and app path instructions when deciding what to review and how to judge the change.
10. Self-check every issue:
   - Is it actionable for a maintainer?
   - Is the failure mode or risk concrete?
   - Is there evidence from the diff or repository?
   - Can you include a file and line reference when possible?
11. Put blocking/high-confidence bugs in criticalIssues.
12. Put meaningful non-blocking risks or edge cases in potentialIssues.
13. Put non-blocking improvements in suggestions only.
14. Put broad uncertainty or context observations in notes only.

## Output Contract
Return JSON matching the provided schema.

Schema semantics:
- reviewLanguage MUST be "ko-KR".
- assessment is "safe", "risky", or "needs_revision".
- changeIntent explains the purpose and user/system impact context of the change in one or two concise Korean sentences. It is not a file list.
- reviewEffort.score is 1 for trivial and 5 for very complex.
- changedFilesSummary summarizes changed files or grouped related files.
- riskAreas lists concrete risk themes in Korean.
- criticalIssues contains only real bugs, breaking changes, security risks, data loss risks, or high-confidence regressions.
- potentialIssues contains meaningful edge cases, side effects, performance concerns, maintainability risks, or test gaps.
- suggestions contains non-blocking improvements; suggestions alone should not make shouldPostComment true.
- testSuggestions contains missing tests or edge cases worth covering.
- flowSummary contains short runtime/API/event-flow steps only when the change affects interactions, APIs, events, async workflows, or lifecycle order. Otherwise return [].
- toolFindingsUsed lists the tool finding titles that materially influenced your review result. Return [] if none were confirmed.
- confidenceReason explains why your final review confidence is sufficient or limited.
- shouldPostComment means "there are actionable findings", not whether the service will post a completion summary.
- shouldPostComment is true only when maintainers should act on criticalIssues or potentialIssues.
- shouldPostComment is false when there are no actionable findings, even if summary, notes, suggestions, or testSuggestions are present. The service can still post a concise completion summary.
- commentReason explains in Korean why maintainers do or do not need to act.

Be precise. Avoid generic advice.`;
}

export function parseStructuredReview(raw: string): StructuredReview {
  const parsed = JSON.parse(stripJsonFence(raw)) as unknown;
  if (!isRecord(parsed)) throw new Error("Codex review response was not a JSON object");

  return {
    reviewLanguage: parseReviewLanguage(parsed.reviewLanguage),
    assessment: parseAssessment(parsed.assessment),
    changeIntent: parseChangeIntent(parsed.changeIntent, parsed.summary),
    reviewEffort: parseReviewEffort(parsed.reviewEffort),
    changedFilesSummary: parseChangedFilesSummary(parsed.changedFilesSummary),
    riskAreas: parseStringArray(parsed.riskAreas, "riskAreas"),
    summary: parseStringArray(parsed.summary, "summary"),
    criticalIssues: parseIssueArray(parsed.criticalIssues, "criticalIssues"),
    potentialIssues: parseIssueArray(parsed.potentialIssues, "potentialIssues"),
    suggestions: parseStringArray(parsed.suggestions, "suggestions"),
    testSuggestions: parseStringArray(parsed.testSuggestions, "testSuggestions"),
    notes: parseStringArray(parsed.notes, "notes"),
    flowSummary: parseFlowSummary(parsed.flowSummary),
    toolFindingsUsed: parseStringArray(parsed.toolFindingsUsed, "toolFindingsUsed"),
    confidenceReason: parseString(parsed.confidenceReason, "confidenceReason"),
    shouldPostComment: parseBoolean(parsed.shouldPostComment, "shouldPostComment"),
    commentReason: parseString(parsed.commentReason, "commentReason")
  };
}

export function renderReviewMarkdown(review: StructuredReview): string {
  const hasActionableIssues = shouldTreatAsFindings(review);
  const sections = [
    "### :mag: 리뷰 요약",
    renderSummaryTable(review, hasActionableIssues),
    "",
    hasActionableIssues ? "> :warning: 액션이 필요한 이슈가 있습니다." : "> :white_check_mark: 액션이 필요한 이슈는 없습니다. 리뷰 완료 요약만 남깁니다.",
    "",
    "### :file_folder: 변경 파일",
    renderChangedFilesTable(review.changedFilesSummary),
    "",
    "### :rotating_light: 주요 이슈",
    renderIssuesTable(review.criticalIssues),
    "",
    "### :warning: 잠재 이슈",
    renderIssuesTable(review.potentialIssues),
    "",
    "### :bulb: 개선 제안",
    renderStringTable(review.suggestions, "개선 제안 없음."),
    "",
    "### :test_tube: 테스트 제안",
    renderStringTable(review.testSuggestions, "추가 테스트 제안 없음.")
  ];

  if (review.flowSummary.length) {
    sections.push("", "### :twisted_rightwards_arrows: 흐름 요약", renderFlowSummaryTable(review.flowSummary));
  }

  sections.push(
    "",
    "### :memo: 참고",
    renderStringTable(
      [
        ...review.riskAreas.map((area) => `위험 영역: ${area}`),
        ...review.toolFindingsUsed.map((finding) => `확인한 도구 결과: ${finding}`),
        `신뢰도 판단: ${review.confidenceReason}`,
        ...review.notes
      ],
      "추가 참고 없음."
    )
  );
  return sections.join("\n").trim();
}

function renderPromptList(values: string[], empty: string): string {
  if (!values.length) return `- ${empty}`;
  return values.slice(0, 200).map((value) => `- ${value}`).join("\n");
}

function renderPromptInstructions(values: PromptReviewInstruction[]): string {
  if (!values.length) return "- No app-level path instructions matched this change.";
  return values
    .map((value, index) => [
      `${index + 1}. Path: ${value.pathGlob}`,
      `   Matched files: ${value.matchedFiles.join(", ")}`,
      `   Instructions: ${value.instructions}`
    ].join("\n"))
    .join("\n");
}

function renderPromptToolFindings(values: PromptToolFinding[]): string {
  if (!values.length) return "- No static analysis findings were produced.";
  return values
    .slice(0, 30)
    .map((value, index) => {
      const location = value.file ? `${value.file}${value.line ? `:${value.line}` : ""}` : "no location";
      return `${index + 1}. [${value.severity}] ${value.tool}: ${value.title} (${location}) - ${value.summary}`;
    })
    .join("\n");
}

export function shouldTreatAsFindings(review: StructuredReview): boolean {
  return review.criticalIssues.length > 0 || review.potentialIssues.length > 0;
}

function renderSummaryTable(review: StructuredReview, hasActionableIssues: boolean): string {
  return renderTable(
    ["항목", "내용"],
    [
      ["변경 목적", review.changeIntent],
      ["전체 평가", assessmentLabel(review.assessment)],
      ["조치 필요", hasActionableIssues ? "있음" : "없음"],
      ["리뷰 난이도", `${review.reviewEffort.score}/5 - ${review.reviewEffort.reason}`],
      ["핵심 요약", review.summary.length ? review.summary.join("<br>") : "요약 없음."],
      ["판단 근거", review.commentReason]
    ]
  );
}

function renderChangedFilesTable(values: ChangedFileSummary[]): string {
  if (!values.length) return renderEmptyTable("변경 파일 요약 없음.");
  return renderTable(
    ["위험도", "파일", "요약"],
    values.map((value) => [riskLevelLabel(value.riskLevel), `\`${value.path}\``, value.summary])
  );
}

function renderIssuesTable(issues: ReviewIssue[]): string {
  if (!issues.length) return "> 없음.";
  return issues.map(renderIssueCard).join("\n\n");
}

function renderIssueCard(issue: ReviewIssue, index: number): string {
  const location = renderIssueLocation(issue);
  const rows = [
    ["분류", categoryLabel(issue.category)],
    ["신뢰도", `${Math.round(issue.confidence * 100)}%`],
    ["위치", location.short],
    ["이슈", issue.details],
    ["영향", issue.impact],
    ["권장 조치", issue.recommendation]
  ];
  const sections = [
    `#### ${index + 1}. [${severityLabel(issue.severity)}] ${markdownText(issue.title)}`,
    "",
    renderTable(["항목", "내용"], rows)
  ];

  if (location.full) {
    sections.push(
      "",
      "<details>",
      "<summary>전체 경로</summary>",
      "",
      location.full,
      "",
      "</details>"
    );
  }

  return sections.join("\n");
}

function renderIssueLocation(issue: ReviewIssue): { short: string; full: string | null } {
  if (!issue.file) return { short: "-", full: null };
  const fullPath = locationText(issue.file, issue.line);
  const shortPath = locationText(shortenPath(issue.file), issue.line);
  const full = fullPath === shortPath ? null : inlineCode(fullPath);
  return { short: inlineCode(shortPath), full };
}

function locationText(path: string, line: number | null): string {
  return line ? `${path}:${line}` : path;
}

function shortenPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 3) return path;
  return parts.slice(-3).join("/");
}

function renderStringTable(values: string[], emptyMessage: string): string {
  if (!values.length) return renderEmptyTable(emptyMessage);
  return renderTable(
    ["#", "내용"],
    values.map((value, index) => [String(index + 1), value])
  );
}

function renderFlowSummaryTable(values: FlowSummaryStep[]): string {
  return renderTable(
    ["단계", "주체", "동작", "주의점"],
    values.map((value) => [value.step, value.actor, value.action, value.caution ?? "-"])
  );
}

function renderEmptyTable(message: string): string {
  return renderTable(["상태", "내용"], [["-", message]]);
}

function renderTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.map(tableCell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(tableCell).join(" | ")} |`)
  ].join("\n");
}

function tableCell(value: string): string {
  return markdownText(value);
}

function markdownText(value: string): string {
  const text = value.trim() || "-";
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

function inlineCode(value: string): string {
  return `\`${value.replace(/`/g, "'")}\``;
}

function stripJsonFence(raw: string): string {
  return raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function parseReviewLanguage(value: unknown): "ko-KR" {
  if (value === "ko-KR") return value;
  throw new Error("Codex review response has invalid reviewLanguage");
}

function parseAssessment(value: unknown): ReviewAssessment {
  if (value === "safe" || value === "risky" || value === "needs_revision") return value;
  throw new Error("Codex review response has invalid assessment");
}

function parseReviewEffort(value: unknown): ReviewEffort {
  if (!isRecord(value)) throw new Error("Codex review response has invalid reviewEffort");
  const score = parseNumber(value.score, "reviewEffort.score");
  if (score < 1 || score > 5) throw new Error("Codex review response has invalid reviewEffort.score");
  return {
    score,
    reason: parseString(value.reason, "reviewEffort.reason")
  };
}

function parseChangedFilesSummary(value: unknown): ChangedFileSummary[] {
  if (!Array.isArray(value)) throw new Error("Codex review response has invalid changedFilesSummary");
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("Codex review response has invalid changedFilesSummary");
    return {
      path: parseString(item.path, "changedFilesSummary.path"),
      summary: parseString(item.summary, "changedFilesSummary.summary"),
      riskLevel: parseRiskLevel(item.riskLevel)
    };
  });
}

function parseFlowSummary(value: unknown): FlowSummaryStep[] {
  if (!Array.isArray(value)) throw new Error("Codex review response has invalid flowSummary");
  return value.map((item) => {
    if (!isRecord(item)) throw new Error("Codex review response has invalid flowSummary");
    return {
      step: parseString(item.step, "flowSummary.step"),
      actor: parseString(item.actor, "flowSummary.actor"),
      action: parseString(item.action, "flowSummary.action"),
      caution: parseNullableString(item.caution, "flowSummary.caution")
    };
  });
}

function parseRiskLevel(value: unknown): ReviewRiskLevel {
  if (value === "low" || value === "medium" || value === "high") return value;
  throw new Error("Codex review response has invalid riskLevel");
}

function parseSeverity(value: unknown): ReviewSeverity {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") return value;
  throw new Error("Codex review response has invalid severity");
}

function parseCategory(value: unknown): ReviewCategory {
  if (
    value === "bug" ||
    value === "regression" ||
    value === "security" ||
    value === "data_loss" ||
    value === "api_contract" ||
    value === "concurrency" ||
    value === "performance" ||
    value === "testing" ||
    value === "maintainability"
  ) {
    return value;
  }
  throw new Error("Codex review response has invalid category");
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`Codex review response has invalid ${field}`);
  return value.map((item) => parseString(item, field));
}

function parseIssueArray(value: unknown, field: string): ReviewIssue[] {
  if (!Array.isArray(value)) throw new Error(`Codex review response has invalid ${field}`);
  return value.map((item) => {
    if (!isRecord(item)) throw new Error(`Codex review response has invalid ${field}`);
    const confidence = parseNumber(item.confidence, `${field}.confidence`);
    if (confidence < 0 || confidence > 1) throw new Error(`Codex review response has invalid ${field}.confidence`);
    return {
      severity: parseSeverity(item.severity),
      confidence,
      category: parseCategory(item.category),
      title: parseString(item.title, `${field}.title`),
      file: parseNullableString(item.file, `${field}.file`),
      line: parseNullableNumber(item.line, `${field}.line`),
      details: parseString(item.details, `${field}.details`),
      impact: parseString(item.impact, `${field}.impact`),
      recommendation: parseString(item.recommendation, `${field}.recommendation`)
    };
  });
}

function parseString(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`Codex review response has invalid ${field}`);
  return value;
}

function parseChangeIntent(value: unknown, summary: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  if (Array.isArray(summary)) {
    const firstSummary = summary.find((item): item is string => typeof item === "string" && item.trim().length > 0);
    if (firstSummary) return firstSummary;
  }
  return "변경 목적 정보 없음.";
}

function parseNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  if (typeof value === "string") return value;
  throw new Error(`Codex review response has invalid ${field}`);
}

function parseNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`Codex review response has invalid ${field}`);
  return value;
}

function parseNullableNumber(value: unknown, field: string): number | null {
  if (value === null) return null;
  return parseNumber(value, field);
}

function parseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`Codex review response has invalid ${field}`);
  return value;
}

function assessmentLabel(value: ReviewAssessment): string {
  switch (value) {
    case "safe":
      return "안전";
    case "risky":
      return "위험 가능";
    case "needs_revision":
      return "수정 필요";
  }
}

function riskLevelLabel(value: ReviewRiskLevel): string {
  switch (value) {
    case "low":
      return "낮음";
    case "medium":
      return "중간";
    case "high":
      return "높음";
  }
}

function severityLabel(value: ReviewSeverity): string {
  switch (value) {
    case "critical":
      return "치명적";
    case "high":
      return "높음";
    case "medium":
      return "중간";
    case "low":
      return "낮음";
  }
}

function categoryLabel(value: ReviewCategory): string {
  switch (value) {
    case "bug":
      return "버그";
    case "regression":
      return "회귀";
    case "security":
      return "보안";
    case "data_loss":
      return "데이터 손실";
    case "api_contract":
      return "API 계약";
    case "concurrency":
      return "동시성";
    case "performance":
      return "성능";
    case "testing":
      return "테스트";
    case "maintainability":
      return "유지보수";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
