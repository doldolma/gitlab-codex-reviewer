import { afterEach, describe, expect, it, vi } from "vitest";
import { ReviewerBotService } from "../lib/reviewer-bot";
import { SecretStore } from "../lib/secret-store";
import { testConfig, testDb } from "./test-utils";

describe("ReviewerBotService", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores bot token encrypted and returns only status metadata", async () => {
    const config = testConfig();
    const db = await testDb(config);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ id: 101, username: "gitlab-codex-reviewer", name: "GitLab Codex Reviewer" }), {
          status: 200
        })
      )
    );

    const service = new ReviewerBotService(db, config, new SecretStore(config));
    const status = await service.saveToken("glpat-secret");
    const row = await db.reviewerBotConnection.findUnique({ where: { id: 1 } });

    expect(status.connected).toBe(true);
    expect(status.username).toBe("gitlab-codex-reviewer");
    expect(row?.encryptedToken).not.toBe("glpat-secret");
    expect(JSON.stringify(status)).not.toContain("glpat-secret");
    await db.$disconnect();
  });

  it("does not store invalid tokens", async () => {
    const config = testConfig();
    const db = await testDb(config);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Unauthorized", { status: 401 })));

    const service = new ReviewerBotService(db, config, new SecretStore(config));

    await expect(service.saveToken("bad-token")).rejects.toThrow("401");
    expect(await db.reviewerBotConnection.count()).toBe(0);
    await db.$disconnect();
  });
});
