export type ReviewProfile = "chill" | "assertive";

export type ProjectReviewInstructionInput = {
  id?: number;
  pathGlob: string;
  instructions: string;
  enabled: boolean;
};

export type ProjectReviewInstruction = Required<ProjectReviewInstructionInput>;

export type ProjectReviewConfig = {
  reviewProfile: ReviewProfile;
  pathFilters: string[];
  instructions: ProjectReviewInstruction[];
};

export type MatchedReviewInstruction = {
  pathGlob: string;
  instructions: string;
  matchedFiles: string[];
};

export const REVIEW_PROFILES = ["chill", "assertive"] as const;

const DEFAULT_EXCLUDE_FILTERS = [
  "!**/node_modules/**",
  "!**/.next/**",
  "!**/dist/**",
  "!**/build/**",
  "!**/.cache/**",
  "!**/coverage/**"
];

export function parseReviewProfile(value: string | null | undefined): ReviewProfile {
  return value === "chill" ? "chill" : "assertive";
}

export function normalizePathFilters(values: string[]): string[] {
  return uniqueNonEmpty(values).slice(0, 100);
}

export function normalizeInstructions(values: ProjectReviewInstructionInput[]): ProjectReviewInstructionInput[] {
  return values
    .map((value) => ({
      id: value.id,
      pathGlob: value.pathGlob.trim(),
      instructions: value.instructions.trim(),
      enabled: Boolean(value.enabled)
    }))
    .filter((value) => value.pathGlob && value.instructions)
    .slice(0, 100);
}

export function defaultPathFilters(): string[] {
  return [...DEFAULT_EXCLUDE_FILTERS];
}

export function filterChangedFiles(paths: string[], pathFilters: string[]): string[] {
  const filters = normalizePathFilters(pathFilters);
  const includeFilters = filters.filter((filter) => !filter.startsWith("!"));
  const excludeFilters = filters.filter((filter) => filter.startsWith("!")).map((filter) => filter.slice(1));

  return uniqueNonEmpty(paths).filter((path) => {
    const normalized = normalizePath(path);
    if (includeFilters.length && !includeFilters.some((filter) => matchesGlob(normalized, filter))) return false;
    if (excludeFilters.some((filter) => matchesGlob(normalized, filter))) return false;
    return true;
  });
}

export function shouldIncludeChangedFile(path: string, pathFilters: string[]): boolean {
  return filterChangedFiles([path], pathFilters).length > 0;
}

export function matchReviewInstructions(
  instructions: ProjectReviewInstruction[],
  changedFiles: string[],
  pathFilters: string[]
): MatchedReviewInstruction[] {
  const reviewableFiles = filterChangedFiles(changedFiles, pathFilters);
  return instructions
    .filter((instruction) => instruction.enabled)
    .map((instruction) => ({
      pathGlob: instruction.pathGlob,
      instructions: instruction.instructions,
      matchedFiles: reviewableFiles.filter((path) => matchesGlob(path, instruction.pathGlob)).slice(0, 30)
    }))
    .filter((instruction) => instruction.matchedFiles.length > 0)
    .slice(0, 20);
}

export function matchesGlob(path: string, glob: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedGlob = normalizePath(glob);
  const regexp = new RegExp(`^${globToRegexpSource(normalizedGlob)}$`);
  return regexp.test(normalizedPath);
}

function globToRegexpSource(glob: string): string {
  let source = "";
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];
    const afterNext = glob[index + 2];
    if (char === "*" && next === "*" && afterNext === "/") {
      source += "(?:.*/)?";
      index += 2;
      continue;
    }
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += escapeRegExp(char);
  }
  return source;
}

function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}
