import { beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_OUTPUT_SCHEMA, buildReviewPrompt, renderReviewMarkdown, shouldTreatAsFindings, type StructuredReview } from "../lib/prompts";
import { CodexReviewEngine, type ReviewEngineEvent } from "../lib/review-engine";
import { CodexReviewTriageEngine, TRIAGE_OUTPUT_SCHEMA } from "../lib/review-triage";

const codexMocks = vi.hoisted(() => {
  const runStreamed = vi.fn();
  const startThread = vi.fn(() => ({ runStreamed }));
  const Codex = vi.fn(function MockCodex() {
    return { startThread };
  });
  return { Codex, runStreamed, startThread };
});

vi.mock("@openai/codex-sdk", () => ({
  Codex: codexMocks.Codex
}));

describe("CodexReviewEngine", () => {
  beforeEach(() => {
    codexMocks.Codex.mockClear();
    codexMocks.runStreamed.mockReset();
    codexMocks.startThread.mockClear();
  });

  it("runs Codex in the checked-out workspace with read-only review options", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: eventsForReview(noFindingsReview()) });

    const engine = new CodexReviewEngine({ codexBin: "/opt/codex", codexHome: "/srv/app/.data/codex" });
    const result = await engine.review({
      kind: "commit",
      repoName: "group/service",
      baseRef: "main~1",
      headRef: "main",
      sha: "abc123",
      branchName: "main",
      diffText: "diff text",
      workingDirectory: "/workspaces/service"
    });

    expect(codexMocks.Codex).toHaveBeenCalledWith(
      expect.objectContaining({
        codexPathOverride: "/opt/codex",
        env: expect.objectContaining({ CODEX_HOME: "/srv/app/.data/codex" })
      })
    );
    expect(codexMocks.startThread).toHaveBeenCalledWith({
      model: "gpt-5.5",
      modelReasoningEffort: "high",
      workingDirectory: "/workspaces/service",
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never"
    });
    expect(codexMocks.runStreamed).toHaveBeenCalledWith(expect.stringContaining("Repository: group/service"), {
      outputSchema: REVIEW_OUTPUT_SCHEMA
    });
    expect(result.hasFindings).toBe(false);
    expect(result.markdown).toContain("### :mag: 리뷰 요약");
    expect(result.markdown).toContain("| 전체 평가 | 안전 |");
    expect(result.markdown).toContain("| 조치 필요 | 없음 |");
  });

  it("returns rendered markdown findings from structured output", async () => {
    codexMocks.runStreamed.mockResolvedValue({
      events: eventsForReview({
        ...noFindingsReview(),
        assessment: "needs_revision",
        criticalIssues: [
          {
            title: "Null input can crash handler",
            severity: "high",
            confidence: 0.92,
            category: "bug",
            file: "src/handler.ts",
            line: 42,
            details: "새 호출 경로가 null을 전달할 수 있지만 방어 코드가 없습니다.",
            impact: "런타임에서 요청 처리 중 예외가 발생할 수 있습니다.",
            recommendation: "역참조 전에 입력값을 검증하세요."
          }
        ],
        shouldPostComment: true
      })
    });

    const result = await new CodexReviewEngine().review({
      kind: "merge_request",
      repoName: "group/service",
      sha: "abc123",
      diffText: "diff text"
    });

    expect(result.hasFindings).toBe(true);
    expect(result.markdown).toContain("### :rotating_light: 주요 이슈");
    expect(result.markdown).toContain("Null input can crash handler");
    expect(result.markdown).toContain("src/handler.ts:42");
  });

  it("uses runtime review settings when provided", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: eventsForReview(noFindingsReview()) });

    await new CodexReviewEngine().review(
      {
        kind: "commit",
        repoName: "group/service",
        sha: "abc123",
        diffText: "diff text",
        workingDirectory: "/workspaces/service"
      },
      undefined,
      { model: "gpt-5.4", reasoningEffort: "high" }
    );

    expect(codexMocks.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        modelReasoningEffort: "high"
      })
    );
  });

  it("builds a Korean workspace review prompt with repository exploration guardrails", () => {
    const prompt = buildReviewPrompt({
      kind: "merge_request",
      repoName: "group/service",
      baseRef: "main",
      headRef: "feature",
      sha: "abc123",
      branchName: "main",
      diffText: "diff --git a/src/app.ts b/src/app.ts",
      workingDirectory: "/workspaces/service"
    });

    expect(prompt).toContain("review language is fixed to Korean (ko-KR)");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain(".coderabbit.yaml/.coderabbit.yml");
    expect(prompt).toContain("rg");
    expect(prompt).toContain("Do not run tests");
    expect(prompt).toContain("Do not produce Mermaid");
    expect(prompt).toContain("flowSummary");
    expect(prompt).toContain("shouldPostComment is false when there are no actionable findings");
  });

  it("treats only critical or potential issues as postable findings", () => {
    expect(shouldTreatAsFindings({ ...noFindingsReview(), shouldPostComment: true })).toBe(false);
    expect(
      shouldTreatAsFindings({
        ...noFindingsReview(),
        potentialIssues: [
          {
            severity: "medium",
            confidence: 0.8,
            category: "testing",
            title: "경계값 테스트가 없습니다",
            file: "src/service.ts",
            line: 10,
            details: "새 분기 조건의 실패 경로가 테스트되지 않았습니다.",
            impact: "회귀를 놓칠 수 있습니다.",
            recommendation: "실패 경로 테스트를 추가하세요."
          }
        ],
        shouldPostComment: true
      })
    ).toBe(true);
  });

  it("renders compact GitLab-safe tables without Mermaid blocks", () => {
    const markdown = renderReviewMarkdown({
      ...noFindingsReview(),
      summary: ["파이프 문자를 포함한 요약 | 도 안전하게 표시됩니다."],
      changedFilesSummary: [
        {
          path: "src/service|core.ts",
          summary: "여러 줄\n요약을 표 안에서 표시합니다.",
          riskLevel: "medium"
        }
      ],
      flowSummary: [
        {
          step: "1",
          actor: "API",
          action: "요청을 처리합니다.",
          caution: "부작용 없음."
        }
      ]
    });

    expect(markdown).toContain("### :file_folder: 변경 파일");
    expect(markdown).toContain("파이프 문자를 포함한 요약 \\| 도 안전하게 표시됩니다.");
    expect(markdown).toContain("src/service\\|core.ts");
    expect(markdown).toContain("여러 줄<br>요약을 표 안에서 표시합니다.");
    expect(markdown).toContain("### :twisted_rightwards_arrows: 흐름 요약");
    expect(markdown).not.toContain("```mermaid");
  });

  it("emits rich tool, message, and usage events from the Codex stream", async () => {
    const emitted: ReviewEngineEvent[] = [];
    codexMocks.runStreamed.mockResolvedValue({ events: eventsForReview(noFindingsReview(), true) });

    await new CodexReviewEngine().review(
      {
        kind: "commit",
        repoName: "group/service",
        sha: "abc123",
        diffText: "diff text",
        workingDirectory: "/workspaces/service"
      },
      (event) => {
        emitted.push(event);
      }
    );

    expect(emitted.map((event) => event.step)).toContain("codex_tool_used");
    expect(emitted.map((event) => event.step)).toContain("codex_message");
    expect(emitted.map((event) => event.step)).toContain("codex_usage");
    expect(emitted.find((event) => event.step === "codex_tool_used")?.metadata).toEqual(
      expect.objectContaining({
        tool: "command_execution",
        outputBytes: expect.any(Number),
        outputPreview: expect.stringContaining("src/handler.ts"),
        outputTruncated: false
      })
    );
    expect(emitted.find((event) => event.step === "codex_tool_used")?.metadata?.outputPreview).not.toContain("secret-token");
    expect(emitted.find((event) => event.step === "codex_message")?.metadata).toEqual(
      expect.objectContaining({
        markdownPreview: expect.stringContaining("### :mag: 리뷰 요약"),
        assessment: "safe",
        issueCount: 0,
        hasFindings: false
      })
    );
    expect(emitted.find((event) => event.step === "codex_usage")?.metadata).toEqual(
      expect.objectContaining({
        inputTokens: 10,
        outputTokens: 5,
        reasoningOutputTokens: 1,
        totalTokens: 15
      })
    );
  });

  it("fails empty or invalid structured responses instead of treating them as no findings", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: eventsForRawResponse("") });

    await expect(
      new CodexReviewEngine().review({
        kind: "commit",
        repoName: "group/service",
        sha: "abc123",
        diffText: "diff text"
      })
    ).rejects.toThrow("Codex review response was empty");
  });

  it("runs Codex triage with medium reasoning and parses the recommended effort", async () => {
    codexMocks.runStreamed.mockResolvedValue({
      events: eventsForRawResponse(
        JSON.stringify({
          recommendedReasoningEffort: "xhigh",
          riskLevel: "high",
          reason: "worker lock과 webhook 흐름을 함께 바꿉니다.",
          riskSignals: ["동시성", "webhook"]
        })
      )
    });

    const result = await new CodexReviewTriageEngine({ codexHome: "/srv/app/.data/codex" }).triage(
      {
        kind: "merge_request",
        repoName: "group/service",
        sha: "abc123",
        diffText: "diff --git a/src/worker.ts b/src/worker.ts",
        changedFiles: ["src/worker.ts"],
        diffBytes: 512,
        diffTruncated: false,
        omittedFiles: 0,
        workingDirectory: "/workspaces/service"
      },
      { model: "gpt-5.5" }
    );

    expect(codexMocks.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.5",
        modelReasoningEffort: "medium",
        workingDirectory: "/workspaces/service",
        skipGitRepoCheck: true
      })
    );
    expect(codexMocks.runStreamed).toHaveBeenCalledWith(expect.stringContaining("Your only task is to estimate the risk"), {
      outputSchema: TRIAGE_OUTPUT_SCHEMA
    });
    expect(result).toMatchObject({
      recommendedReasoningEffort: "xhigh",
      riskLevel: "high",
      riskSignals: ["동시성", "webhook"]
    });
  });
});

function noFindingsReview(): StructuredReview {
  return {
    reviewLanguage: "ko-KR",
    assessment: "safe",
    reviewEffort: {
      score: 2,
      reason: "변경 범위가 작고 영향 파일이 적습니다."
    },
    changedFilesSummary: [
      {
        path: "src/service.ts",
        summary: "서비스 처리 흐름이 일부 조정되었습니다.",
        riskLevel: "low"
      }
    ],
    riskAreas: [],
    summary: ["변경은 좁은 범위에 머물러 있습니다."],
    criticalIssues: [],
    potentialIssues: [],
    suggestions: [],
    testSuggestions: ["기존 회귀 테스트가 계속 통과하는지 확인하세요."],
    notes: [],
    flowSummary: [],
    shouldPostComment: false,
    commentReason: "게시할 actionable finding이 없습니다."
  };
}

async function* eventsForReview(review: StructuredReview, includeTool = false) {
  if (includeTool) {
    yield {
      type: "item.completed",
      item: {
        id: "cmd-1",
        type: "command_execution",
        command: "rg handler -H 'Authorization: Bearer secret-token'",
        aggregated_output: "src/handler.ts\nAuthorization: Bearer secret-token",
        status: "completed",
        exit_code: 0
      }
    };
  }
  yield* eventsForRawResponse(JSON.stringify(review));
}

async function* eventsForRawResponse(response: string) {
  yield { type: "item.completed", item: { id: "msg-1", type: "agent_message", text: response } };
  yield {
    type: "turn.completed",
    usage: {
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
      reasoning_output_tokens: 1
    }
  };
}
