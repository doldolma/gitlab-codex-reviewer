const MANAGED_START = "<!-- gitlab-codex-reviewer:release-notes:start -->";
const MANAGED_END = "<!-- gitlab-codex-reviewer:release-notes:end -->";

export function composeGitLabReleaseDescription(
  existingDescription: string | null | undefined,
  markdown: string,
  trigger: "manual" | "webhook",
  tagName: string,
  generatedAt = new Date().toISOString()
): string {
  const cleanExisting = stripLegacyAppendix(stripManagedBlocks(existingDescription ?? "")).trim();
  const nextMarkdown = markdown.trim();
  if (!cleanExisting || looksLikeGeneratedReleaseNote(cleanExisting, nextMarkdown, tagName)) {
    return managedBlock(nextMarkdown);
  }

  const triggerLabel = trigger === "manual" ? "수동 작성" : "자동 작성";
  const addition = [
    "---",
    "",
    `## 추가 릴리즈노트 (${triggerLabel}, ${generatedAt})`,
    "",
    nextMarkdown
  ].join("\n");
  return `${cleanExisting}\n\n${managedBlock(addition)}`;
}

function managedBlock(value: string): string {
  return [MANAGED_START, "", value, "", MANAGED_END].join("\n");
}

function stripManagedBlocks(value: string): string {
  return value.replace(/<!-- gitlab-codex-reviewer:release-notes:start -->[\s\S]*?<!-- gitlab-codex-reviewer:release-notes:end -->/g, "").trim();
}

function stripLegacyAppendix(value: string): string {
  return value.replace(/\n{2,}---\n\n## 추가 릴리즈노트 \([^)]*\)\n\n[\s\S]*$/m, "").trim();
}

function looksLikeGeneratedReleaseNote(existing: string, markdown: string, tagName: string): boolean {
  if (normalize(existing) === normalize(markdown)) return true;
  const firstLine = existing.trim().split(/\r?\n/)[0] ?? "";
  return (
    firstLine.startsWith(`# ${tagName}`) &&
    existing.includes("## 주요 변화") &&
    existing.includes("## 개선 사항") &&
    existing.includes("## 수정 사항")
  );
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}
