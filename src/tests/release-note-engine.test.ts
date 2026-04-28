import { beforeEach, describe, expect, it, vi } from "vitest";
import { CodexReleaseNoteEngine, type ReleaseNoteEngineEvent } from "../lib/release-note-engine";
import { RELEASE_NOTE_OUTPUT_SCHEMA } from "../lib/release-note-prompts";

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

describe("CodexReleaseNoteEngine", () => {
  beforeEach(() => {
    codexMocks.Codex.mockClear();
    codexMocks.runStreamed.mockReset();
    codexMocks.startThread.mockClear();
  });

  it("runs Codex in the checked-out workspace and emits release note stream events", async () => {
    codexMocks.runStreamed.mockResolvedValue({ events: eventsForReleaseNote(true) });
    const captured: ReleaseNoteEngineEvent[] = [];

    const result = await new CodexReleaseNoteEngine({ codexBin: "/opt/codex", codexHome: "/srv/app/.data/codex" }).write(
      {
        projectName: "Group / Service",
        tagName: "v1.2.0",
        previousTagName: "v1.1.0",
        commitCount: 1,
        commits: [{ id: "abc123", title: "Improve operator dashboard" }],
        diffText: "diff --git a/README.md b/README.md",
        diffTruncated: false,
        omittedFiles: 0,
        workingDirectory: "/workspaces/service",
        changedFiles: ["README.md"],
        domainContext: "운영자는 정산 정확도를 중요하게 봅니다."
      },
      (event) => {
        captured.push(event);
      },
      { model: "gpt-5.5", reasoningEffort: "xhigh" }
    );

    expect(codexMocks.Codex).toHaveBeenCalledWith(
      expect.objectContaining({
        codexPathOverride: "/opt/codex",
        env: expect.objectContaining({ CODEX_HOME: "/srv/app/.data/codex" })
      })
    );
    expect(codexMocks.startThread).toHaveBeenCalledWith({
      model: "gpt-5.5",
      modelReasoningEffort: "xhigh",
      workingDirectory: "/workspaces/service",
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      approvalPolicy: "never"
    });
    expect(codexMocks.runStreamed).toHaveBeenCalledWith(expect.stringContaining("Domain Context"), {
      outputSchema: RELEASE_NOTE_OUTPUT_SCHEMA
    });
    expect(result.markdown).toContain("# v1.2.0 릴리즈");
    expect(captured.map((event) => event.step)).toEqual(["codex_tool_used", "codex_message", "codex_usage"]);
    expect(captured[0]?.metadata?.command).toBe("rg dashboard -H 'Authorization: <redacted>'");
  });
});

async function* eventsForReleaseNote(includeTool = false) {
  if (includeTool) {
    yield {
      type: "item.completed",
      item: {
        id: "cmd-1",
        type: "command_execution",
        command: "rg dashboard -H 'Authorization: Bearer secret-token'",
        aggregated_output: "README.md\nAuthorization: Bearer secret-token",
        status: "completed",
        exit_code: 0
      }
    };
  }
  yield {
    type: "item.completed",
    item: {
      id: "msg-1",
      type: "agent_message",
      text: JSON.stringify({
        releaseLanguage: "ko-KR",
        title: "v1.2.0 릴리즈",
        overview: "운영자가 주요 정보를 더 안정적으로 확인할 수 있는 업데이트입니다.",
        highlights: ["대시보드 확인 흐름이 개선되었습니다."],
        improvements: [],
        fixes: [],
        upgradeNotes: [],
        knownLimitations: [],
        closingNote: "안정적인 사용을 위해 최신 버전으로 업데이트하세요."
      })
    }
  };
  yield {
    type: "turn.completed",
    usage: {
      input_tokens: 100,
      cached_input_tokens: 20,
      output_tokens: 30,
      reasoning_output_tokens: 10
    }
  };
}
