"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { apiGet, type GitLabBranchOption, type GitLabCommitOption, type GitLabProjectOption } from "../lib/api-client";

export function GitLabProjectCombobox({
  value,
  onChange,
  onProjectSelect,
  placeholder = "프로젝트 검색",
  required = false
}: {
  value: string;
  onChange: (value: string) => void;
  onProjectSelect?: (project: GitLabProjectOption) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const selectedValueRef = useRef<string | null>(null);
  const debouncedSearch = useDebouncedValue(inputValue, 250);

  useEffect(() => {
    if (selectedValueRef.current === value) return;
    setInputValue(value);
    selectedValueRef.current = null;
  }, [value]);

  const projects = useQuery({
    queryKey: ["gitlab-project-options", debouncedSearch],
    queryFn: () =>
      apiGet<{ projects: GitLabProjectOption[] }>(
        `/api/gitlab/projects${debouncedSearch.trim() ? `?search=${encodeURIComponent(debouncedSearch.trim())}` : ""}`
      ),
    enabled: open
  });

  function selectProject(project: GitLabProjectOption) {
    const nextValue = String(project.id);
    selectedValueRef.current = nextValue;
    setInputValue(project.nameWithNamespace);
    onChange(nextValue);
    onProjectSelect?.(project);
    setOpen(false);
  }

  return (
    <div
      className="combobox"
      onBlur={() =>
        window.setTimeout(() => {
          setOpen(false);
          if (!selectedValueRef.current) setInputValue("");
        }, 120)
      }
    >
      <input
        value={inputValue}
        required={required}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          selectedValueRef.current = null;
          setInputValue(event.target.value);
          onChange("");
          setOpen(true);
        }}
      />
      {open && (
        <div className="combobox-menu">
          {projects.isLoading && <div className="combobox-message">프로젝트를 불러오는 중</div>}
          {projects.isError && <div className="combobox-message bad">프로젝트 조회에 실패했습니다.</div>}
          {!projects.isLoading &&
            !projects.isError &&
            (projects.data?.projects ?? []).map((project) => (
              <button
                key={project.id}
                type="button"
                className="combobox-option"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectProject(project)}
              >
                <strong>{project.nameWithNamespace}</strong>
                <span>{project.pathWithNamespace}</span>
              </button>
            ))}
          {!projects.isLoading && !projects.isError && !(projects.data?.projects ?? []).length && (
            <div className="combobox-message">검색된 프로젝트가 없습니다.</div>
          )}
        </div>
      )}
    </div>
  );
}

export function BranchMultiCombobox({
  projectId,
  values,
  onChange,
  placeholder = "브랜치 입력 또는 선택"
}: {
  projectId: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const debouncedSearch = useDebouncedValue(inputValue, 250);
  const normalizedValues = useMemo(() => new Set(values.map((value) => value.toLowerCase())), [values]);
  const branches = useBranches(projectId, debouncedSearch, open);

  function addBranch(branchName: string) {
    const trimmed = branchName.trim();
    if (!trimmed || normalizedValues.has(trimmed.toLowerCase())) return;
    onChange([...values, trimmed]);
    setInputValue("");
    setOpen(false);
  }

  function removeBranch(branchName: string) {
    onChange(values.filter((value) => value !== branchName));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addBranch(inputValue);
    }
    if (event.key === "Backspace" && !inputValue && values.length) {
      removeBranch(values[values.length - 1]);
    }
  }

  return (
    <div
      className="combobox"
      onBlur={() =>
        window.setTimeout(() => {
          addBranch(inputValue);
          setOpen(false);
        }, 120)
      }
    >
      <div className="tag-input">
        {values.map((value) => (
          <span className="tag" key={value}>
            {value}
            <button type="button" onClick={() => removeBranch(value)} title={`${value} 제거`}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          value={inputValue}
          placeholder={values.length ? "" : placeholder}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setInputValue(event.target.value);
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
      </div>
      {open && (
        <BranchMenu
          projectId={projectId}
          branches={branches}
          usedNames={normalizedValues}
          onSelect={(branch) => addBranch(branch.name)}
        />
      )}
    </div>
  );
}

export function BranchCombobox({
  projectId,
  value,
  onChange,
  placeholder = "선택 사항"
}: {
  projectId: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value);
  const debouncedSearch = useDebouncedValue(inputValue, 250);
  const branches = useBranches(projectId, debouncedSearch, open);

  useEffect(() => setInputValue(value), [value]);

  function selectBranch(branch: GitLabBranchOption) {
    setInputValue(branch.name);
    onChange(branch.name);
    setOpen(false);
  }

  return (
    <div className="combobox" onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
      <input
        value={inputValue}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setInputValue(event.target.value);
          onChange(event.target.value);
          setOpen(true);
        }}
      />
      {open && <BranchMenu projectId={projectId} branches={branches} usedNames={new Set()} onSelect={selectBranch} />}
    </div>
  );
}

export function CommitCombobox({
  projectId,
  branchName,
  value,
  onChange,
  placeholder = "커밋 선택"
}: {
  projectId: string;
  branchName: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [selectedCommit, setSelectedCommit] = useState<GitLabCommitOption | null>(null);
  const commits = useCommits(projectId, branchName, open);

  useEffect(() => {
    if (!value) setSelectedCommit(null);
  }, [value]);

  function selectCommit(commit: GitLabCommitOption) {
    setSelectedCommit(commit);
    onChange(commit.sha);
    setOpen(false);
  }

  const displayValue = value
    ? selectedCommit
      ? `${selectedCommit.shortSha} ${selectedCommit.title}`
      : value
    : "";

  return (
    <div className="combobox" onBlur={() => window.setTimeout(() => setOpen(false), 120)}>
      <input
        value={displayValue}
        placeholder={placeholder}
        readOnly
        disabled={!projectId.trim() || !branchName.trim()}
        onFocus={() => setOpen(true)}
      />
      {open && (
        <CommitMenu
          projectId={projectId}
          branchName={branchName}
          commits={commits}
          selectedSha={value}
          onSelect={selectCommit}
        />
      )}
    </div>
  );
}

function BranchMenu({
  projectId,
  branches,
  usedNames,
  onSelect
}: {
  projectId: string;
  branches: ReturnType<typeof useBranches>;
  usedNames: Set<string>;
  onSelect: (branch: GitLabBranchOption) => void;
}) {
  if (!projectId.trim()) {
    return <div className="combobox-menu"><div className="combobox-message">프로젝트를 먼저 선택하세요. 브랜치는 직접 입력할 수도 있습니다.</div></div>;
  }

  const availableBranches = (branches.data?.branches ?? []).filter((branch) => !usedNames.has(branch.name.toLowerCase()));

  return (
    <div className="combobox-menu">
      {branches.isLoading && <div className="combobox-message">브랜치를 불러오는 중</div>}
      {branches.isError && <div className="combobox-message bad">브랜치 조회에 실패했습니다. 직접 입력할 수 있습니다.</div>}
      {!branches.isLoading &&
        !branches.isError &&
        availableBranches.map((branch) => (
            <button
              key={branch.name}
              type="button"
              className="combobox-option"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(branch)}
            >
              <strong>{branch.name}</strong>
              <span>{[branch.default ? "기본" : null, branch.protected ? "보호됨" : null].filter(Boolean).join(" · ")}</span>
            </button>
          ))}
      {!branches.isLoading && !branches.isError && !availableBranches.length && (
        <div className="combobox-message">검색된 브랜치가 없습니다. 직접 입력할 수 있습니다.</div>
      )}
    </div>
  );
}

function CommitMenu({
  projectId,
  branchName,
  commits,
  selectedSha,
  onSelect
}: {
  projectId: string;
  branchName: string;
  commits: ReturnType<typeof useCommits>;
  selectedSha: string;
  onSelect: (commit: GitLabCommitOption) => void;
}) {
  if (!projectId.trim()) {
    return <div className="combobox-menu"><div className="combobox-message">프로젝트를 먼저 선택하세요.</div></div>;
  }
  if (!branchName.trim()) {
    return <div className="combobox-menu"><div className="combobox-message">브랜치를 먼저 선택하세요.</div></div>;
  }

  const options = commits.data?.commits ?? [];

  return (
    <div className="combobox-menu">
      {commits.isLoading && <div className="combobox-message">커밋을 불러오는 중</div>}
      {commits.isError && <div className="combobox-message bad">커밋 조회에 실패했습니다.</div>}
      {!commits.isLoading &&
        !commits.isError &&
        options.map((commit) => (
          <button
            key={commit.sha}
            type="button"
            className={`combobox-option${commit.sha === selectedSha ? " selected" : ""}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(commit)}
          >
            <strong>{commit.title}</strong>
            <span>
              {[commit.shortSha, commit.authorName, commit.committedDate ? new Date(commit.committedDate).toLocaleString() : null]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
        ))}
      {!commits.isLoading && !commits.isError && !options.length && (
        <div className="combobox-message">이 브랜치에서 커밋을 찾지 못했습니다.</div>
      )}
    </div>
  );
}

function useBranches(projectId: string, search: string, open: boolean) {
  return useQuery({
    queryKey: ["gitlab-branch-options", projectId, search],
    queryFn: () =>
      apiGet<{ branches: GitLabBranchOption[] }>(
        `/api/gitlab/branches?projectId=${encodeURIComponent(projectId)}${search.trim() ? `&search=${encodeURIComponent(search.trim())}` : ""}`
      ),
    enabled: open && Boolean(projectId.trim())
  });
}

function useCommits(projectId: string, branchName: string, open: boolean) {
  return useQuery({
    queryKey: ["gitlab-commit-options", projectId, branchName],
    queryFn: () =>
      apiGet<{ commits: GitLabCommitOption[] }>(
        `/api/gitlab/commits?projectId=${encodeURIComponent(projectId)}&branchName=${encodeURIComponent(branchName)}`
      ),
    enabled: open && Boolean(projectId.trim()) && Boolean(branchName.trim())
  });
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);

  return debounced;
}
