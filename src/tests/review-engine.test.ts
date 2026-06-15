import { beforeEach, describe, expect, it, vi } from "vitest";
import { REVIEW_OUTPUT_SCHEMA, buildReviewPrompt, parseStructuredReview, renderReviewMarkdown, shouldTreatAsFindings, type StructuredReview } from "../lib/prompts";
import { CodexReviewEngine, type ReviewEngineEvent } from "../lib/review-engine";
import { CodexReviewTriageEngine, TRIAGE_OUTPUT_SCHEMA } from "../lib/review-triage";
import { defaultModelSettings, runtimeSettings } from "../lib/codex-review-settings";

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
    expect(result.markdown).toContain("| 변경 목적 | 서비스 처리 흐름을 안전하게 조정하는 변경입니다. |");
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
            file: "apps/api/src/main/java/com/gridwiz/derems/apps/api/alarm/controller/v1/AlarmHistoryController.java",
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
    expect(result.markdown).toContain("#### 1. [높음] Null input can crash handler");
    expect(result.markdown).toContain("| 항목 | 내용 |");
    expect(result.markdown).toContain("| 분류 | 버그 |");
    expect(result.markdown).toContain("| 신뢰도 | 92% |");
    expect(result.markdown).toContain("| 위치 | `controller/v1/AlarmHistoryController.java:42` |");
    expect(result.markdown).toContain("<summary>전체 경로</summary>");
    expect(result.markdown).toContain("`apps/api/src/main/java/com/gridwiz/derems/apps/api/alarm/controller/v1/AlarmHistoryController.java:42`");
    expect(result.markdown).not.toContain("| 심각도 | 분류 | 위치 | 이슈 | 영향 | 권장 조치 | 신뢰도 |");
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
      runtimeSettings({ ...defaultModelSettings(), model: "gpt-5.4" }, "high")
    );

    expect(codexMocks.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gpt-5.4",
        modelReasoningEffort: "high"
      })
    );
  });

  it("runs OpenAI compatible models through the Codex custom provider", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: eventsForReview(noFindingsReview()) });

    await new CodexReviewEngine({ codexBin: "/opt/codex", codexHome: "/srv/app/.data/codex" }).review(
      {
        kind: "commit",
        repoName: "group/service",
        sha: "abc123",
        diffText: "diff text",
        workingDirectory: "/workspaces/service"
      },
      undefined,
      {
        provider: "openai_compatible",
        providerLabel: "OpenAI 호환 API",
        model: "qwen-coder",
        baseUrl: "http://qwen.internal:8000/v1",
        apiKey: "secret-key",
        contextWindow: 131072,
        reasoningEffort: "high"
      }
    );

    expect(codexMocks.Codex).toHaveBeenCalledWith(
      expect.objectContaining({
        codexPathOverride: "/opt/codex",
        env: expect.objectContaining({
          CODEX_HOME: "/srv/app/.data/codex",
          OPENAI_COMPATIBLE_API_KEY: "secret-key"
        }),
        config: {
          model_provider: "openai_compatible",
          model_context_window: 131072,
          model_providers: {
            openai_compatible: {
              name: "OpenAI Compatible",
              base_url: "http://qwen.internal:8000/v1",
              env_key: "OPENAI_COMPATIBLE_API_KEY",
              wire_api: "responses"
            }
          }
        }
      })
    );
    expect(codexMocks.startThread).toHaveBeenCalledWith(expect.objectContaining({ model: "qwen-coder" }));
  });

  it("passes abort signal to streamed review turns", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: eventsForReview(noFindingsReview()) });
    const controller = new AbortController();

    await new CodexReviewEngine().review(
      {
        kind: "commit",
        repoName: "group/service",
        sha: "abc123",
        diffText: "diff text"
      },
      undefined,
      undefined,
      { signal: controller.signal }
    );

    expect(codexMocks.runStreamed).toHaveBeenCalledWith(expect.any(String), {
      outputSchema: REVIEW_OUTPUT_SCHEMA,
      signal: controller.signal
    });
  });

  it("can run Codex without the bwrap sandbox for container deployments", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: eventsForReview(noFindingsReview()) });

    await new CodexReviewEngine({ sandboxMode: "danger-full-access" }).review({
      kind: "commit",
      repoName: "group/service",
      sha: "abc123",
      diffText: "diff text",
      workingDirectory: "/workspaces/service"
    });

    expect(codexMocks.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        sandboxMode: "danger-full-access",
        approvalPolicy: "never",
        skipGitRepoCheck: true
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
      workingDirectory: "/workspaces/service",
      changedFiles: ["src/app.ts"],
      pathFilters: ["src/**"],
      matchedInstructions: [
        {
          pathGlob: "src/**",
          matchedFiles: ["src/app.ts"],
          instructions: "인증과 입력 검증을 중점적으로 확인합니다."
        }
      ],
      toolFindings: [
        {
          tool: "rg-risk-scan",
          severity: "medium",
          title: "위험 패턴 후보",
          file: "src/app.ts",
          line: 10,
          summary: "TODO security"
        }
      ],
      reviewProfile: "assertive"
    });

    expect(prompt).toContain("review language is fixed to Korean (ko-KR)");
    expect(prompt).toContain("change intent and impact context");
    expect(prompt).toContain("changeIntent");
    expect(prompt).toContain("It is not a file list");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain(".coderabbit.yaml/.coderabbit.yml");
    expect(prompt).toContain("rg");
    expect(prompt).toContain("Do not run tests");
    expect(prompt).toContain("Do not produce Mermaid");
    expect(prompt).toContain("flowSummary");
    expect(prompt).toContain("shouldPostComment is false when there are no actionable findings");
    expect(prompt).toContain("App Path Instructions");
    expect(prompt).toContain("인증과 입력 검증");
    expect(prompt).toContain("Tool Findings");
    expect(prompt).toContain("Review profile: assertive");
    expect(prompt).toContain("Be assertive and thorough");
    expect(prompt).not.toContain("Be conservative and high-precision");
  });

  it("switches the system style instruction for the chill profile", () => {
    const base = {
      kind: "merge_request" as const,
      repoName: "group/service",
      sha: "abc123",
      diffText: "diff --git a/src/app.ts b/src/app.ts"
    };
    const chill = buildReviewPrompt({ ...base, reviewProfile: "chill" });
    const assertive = buildReviewPrompt({ ...base, reviewProfile: "assertive" });

    expect(chill).toContain("Be conservative and high-precision");
    expect(chill).toContain("Review profile: chill");
    expect(chill).not.toContain("Be assertive and thorough");

    expect(assertive).toContain("Be assertive and thorough");
    expect(assertive).not.toContain("Be conservative and high-precision");
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
      changeIntent: "UI 렌더링 비용을 줄이는 변경 | 입니다.\n목록 갱신 범위를 좁힙니다.",
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
    expect(markdown).toContain("| 변경 목적 | UI 렌더링 비용을 줄이는 변경 \\| 입니다.<br>목록 갱신 범위를 좁힙니다. |");
    expect(markdown).toContain("파이프 문자를 포함한 요약 \\| 도 안전하게 표시됩니다.");
    expect(markdown).toContain("src/service\\|core.ts");
    expect(markdown).toContain("여러 줄<br>요약을 표 안에서 표시합니다.");
    expect(markdown).toContain("### :rotating_light: 주요 이슈\n> 없음.");
    expect(markdown).toContain("### :warning: 잠재 이슈\n> 없음.");
    expect(markdown).toContain("### :twisted_rightwards_arrows: 흐름 요약");
    expect(markdown).not.toContain("```mermaid");
  });

  it("requires changeIntent in the structured output schema but keeps legacy parser fallback", () => {
    expect(REVIEW_OUTPUT_SCHEMA.required).toContain("changeIntent");

    const legacy = noFindingsReview();
    const { changeIntent: _omitted, ...legacyWithoutChangeIntent } = legacy;

    expect(parseStructuredReview(JSON.stringify(legacyWithoutChangeIntent))).toEqual(
      expect.objectContaining({
        changeIntent: legacy.summary[0]
      })
    );
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
    ).rejects.toThrow("AI review response was empty");
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
      defaultModelSettings()
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

  it("passes abort signal to streamed triage turns", async () => {
    codexMocks.runStreamed.mockResolvedValue({
      events: eventsForRawResponse(
        JSON.stringify({
          recommendedReasoningEffort: "high",
          riskLevel: "medium",
          reason: "변경 범위가 보통입니다.",
          riskSignals: []
        })
      )
    });
    const controller = new AbortController();

    await new CodexReviewTriageEngine().triage(
      {
        kind: "commit",
        repoName: "group/service",
        sha: "abc123",
        diffText: "diff text",
        changedFiles: ["src/index.ts"],
        diffBytes: 128,
        diffTruncated: false,
        omittedFiles: 0
      },
      defaultModelSettings(),
      { signal: controller.signal }
    );

    expect(codexMocks.runStreamed).toHaveBeenCalledWith(expect.any(String), {
      outputSchema: TRIAGE_OUTPUT_SCHEMA,
      signal: controller.signal
    });
  });
});

function noFindingsReview(): StructuredReview {
  return {
    reviewLanguage: "ko-KR",
    assessment: "safe",
    changeIntent: "서비스 처리 흐름을 안전하게 조정하는 변경입니다.",
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
    toolFindingsUsed: [],
    confidenceReason: "diff와 관련 컨텍스트가 충분히 좁습니다.",
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
