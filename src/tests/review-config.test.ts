import { describe, expect, it } from "vitest";
import { filterChangedFiles, matchReviewInstructions } from "../lib/review-config";

describe("review config helpers", () => {
  it("applies include and exclude path filters", () => {
    expect(
      filterChangedFiles(
        ["src/app.ts", "src/generated/client.ts", "README.md", "node_modules/pkg/index.js"],
        ["src/**", "!src/generated/**", "!**/node_modules/**"]
      )
    ).toEqual(["src/app.ts"]);
  });

  it("matches only enabled path instructions for reviewable files", () => {
    const matched = matchReviewInstructions(
      [
        {
          id: 1,
          pathGlob: "internal/grpcserver/**",
          instructions: "stream lifecycle을 확인하세요.",
          enabled: true
        },
        {
          id: 2,
          pathGlob: "docs/**",
          instructions: "문서를 확인하세요.",
          enabled: false
        }
      ],
      ["internal/grpcserver/server.go", "docs/readme.md"],
      ["!docs/**"]
    );

    expect(matched).toEqual([
      {
        pathGlob: "internal/grpcserver/**",
        instructions: "stream lifecycle을 확인하세요.",
        matchedFiles: ["internal/grpcserver/server.go"]
      }
    ]);
  });
});
