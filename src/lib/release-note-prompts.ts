import type { GitLabCommit } from "./gitlab-client";

export const RELEASE_NOTE_PROMPT_VERSION = "ko-user-release-notes-v1";

export type ReleaseNotePromptInput = {
  projectName: string;
  tagName: string;
  previousTagName: string | null;
  commitCount: number;
  commits: GitLabCommit[];
  diffText: string;
  diffTruncated: boolean;
  omittedFiles: number;
  workingDirectory?: string | null;
  changedFiles?: string[];
  domainContext?: string | null;
};

export type StructuredReleaseNote = {
  releaseLanguage: "ko-KR";
  title: string;
  overview: string;
  highlights: string[];
  improvements: string[];
  fixes: string[];
  upgradeNotes: string[];
  knownLimitations: string[];
  closingNote: string;
};

export const RELEASE_NOTE_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    releaseLanguage: { type: "string", enum: ["ko-KR"] },
    title: { type: "string" },
    overview: { type: "string" },
    highlights: { type: "array", items: { type: "string" } },
    improvements: { type: "array", items: { type: "string" } },
    fixes: { type: "array", items: { type: "string" } },
    upgradeNotes: { type: "array", items: { type: "string" } },
    knownLimitations: { type: "array", items: { type: "string" } },
    closingNote: { type: "string" }
  },
  required: [
    "releaseLanguage",
    "title",
    "overview",
    "highlights",
    "improvements",
    "fixes",
    "upgradeNotes",
    "knownLimitations",
    "closingNote"
  ]
} as const;

export function buildReleaseNotePrompt(input: ReleaseNotePromptInput): string {
  const range = input.previousTagName ? `${input.previousTagName}부터 ${input.tagName}까지` : `${input.tagName}까지`;
  const workspaceLine = input.workingDirectory
    ? "You are running inside the checked-out Git repository at the selected tag. Use read-only tools when useful to inspect README, docs, changed files, configuration, UI copy, schemas, and product-facing behavior."
    : "A repository workspace is not available. Write only from the provided commits and diff.";
  return `SYSTEM:
You are a product release note writer.

Write in Korean (ko-KR). The intended readers are product users, operators, and stakeholders, not developers. 개발자가 아닌 프로젝트 사용자가 읽는 릴리즈노트로 작성한다.

Style:
- Explain user-visible value first.
- Avoid commit hashes, internal file names, method names, implementation details, and engineering jargon unless the change cannot be understood without them.
- Do not invent features. If the evidence is unclear, write conservatively as "품질 개선", "안정성 개선", or "내부 개선".
- Group meaningful changes into highlights, improvements, fixes, upgradeNotes, and knownLimitations.
- Keep each bullet concise and specific.
- Do not mention that you read a diff.
- Return only JSON that matches the schema.

Tool policy:
- Use available read-only tools when needed to understand user-facing behavior, terminology, product documentation, configuration, or changed files.
- Do not modify files.
- Do not run tests, package managers, network calls, build commands, migrations, formatters, generators, or any command with side effects.
- Prefer read-only commands: rg, git show, git diff, git status, sed, cat, ls, find.

${workspaceLine}

USER:

## Release Context
Project: ${input.projectName}
Tag: ${input.tagName}
Range: ${range}
Prompt version: ${RELEASE_NOTE_PROMPT_VERSION}
Commit count: ${input.commitCount}
Diff truncated: ${input.diffTruncated ? `yes, omitted files: ${input.omittedFiles}` : "no"}

## Changed Files
${renderList(input.changedFiles ?? [], "No changed files were provided.")}

## Domain Context
${input.domainContext?.trim() || "No project-specific release note context was configured."}

Use Domain Context only to interpret terminology, audience, and user impact. Do not invent features or behavior that is not supported by commits, diff, or read-only repository evidence.

## Commit Summaries
${renderCommits(input.commits)}

## Unified Diff
\`\`\`diff
${input.diffText}
\`\`\`

## Required JSON
- title: "${input.tagName}"를 포함한 짧은 릴리즈 제목
- overview: 이번 릴리즈의 사용자 관점 요약 한 문단
- highlights: 새 기능이나 눈에 띄는 변화
- improvements: 사용성, 성능, 안정성, 운영 품질 개선
- fixes: 버그 수정
- upgradeNotes: 사용자가 알아야 할 변경, 설정, 배포, 호환성 메모
- knownLimitations: 확인된 제한이나 주의사항. 없으면 빈 배열
- closingNote: 짧은 마무리 문장`;
}

export function parseStructuredReleaseNote(raw: string): StructuredReleaseNote {
  return JSON.parse(raw) as StructuredReleaseNote;
}

export function renderReleaseNoteMarkdown(note: StructuredReleaseNote): string {
  const sections = [
    `# ${note.title.trim()}`,
    "",
    note.overview.trim(),
    renderSection("주요 변화", note.highlights),
    renderSection("개선 사항", note.improvements),
    renderSection("수정 사항", note.fixes),
    renderSection("업데이트 전 확인", note.upgradeNotes),
    renderSection("알려진 제한", note.knownLimitations),
    note.closingNote.trim()
  ];
  return sections.filter(Boolean).join("\n\n").trim();
}

function renderCommits(commits: GitLabCommit[]): string {
  if (!commits.length) return "No commit summary was provided.";
  return commits.slice(0, 200).map((commit, index) => {
    const title = commit.title ?? commit.message?.split("\n")[0] ?? commit.id.slice(0, 12);
    const body = commit.message?.split("\n").slice(1).join("\n").trim();
    const lines = [`${index + 1}. ${title}`];
    if (body) lines.push(indent(truncate(body, 800)));
    return lines.join("\n");
  }).join("\n");
}

function renderSection(title: string, items: string[]): string {
  const cleanItems = items.map((item) => item.trim()).filter(Boolean);
  if (!cleanItems.length) return "";
  return [`## ${title}`, ...cleanItems.map((item) => `- ${item}`)].join("\n");
}

function renderList(values: string[], fallback: string): string {
  const normalized = values.map((value) => value.trim()).filter(Boolean);
  if (!normalized.length) return fallback;
  return normalized.slice(0, 200).map((value) => `- ${value}`).join("\n");
}

function indent(value: string): string {
  return value.split(/\r?\n/).map((line) => `   ${line}`).join("\n");
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}
