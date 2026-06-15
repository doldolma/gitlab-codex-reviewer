import { describe, expect, it } from "vitest";
import { CodexReviewSettingsError, CodexReviewSettingsPermissionError, CodexReviewSettingsService } from "../lib/codex-review-settings";
import { SecretStore } from "../lib/secret-store";
import { insertTestUser, testConfig, testDb } from "./test-utils";

describe("CodexReviewSettingsService", () => {
  it("returns default review settings when no row exists", async () => {
    const db = await testDb();
    const service = new CodexReviewSettingsService(db);

    await expect(service.getEffectiveReviewSettings()).resolves.toMatchObject({
      provider: "codex",
      model: "gpt-5.5",
      strategyMode: "project",
      isDefault: true
    });

    await db.$disconnect();
  });

  it("allows admins to update instance-wide Codex settings", async () => {
    const db = await testDb();
    const service = new CodexReviewSettingsService(db);
    const adminId = await insertTestUser(db, { gitlabUserId: 1, username: "admin", role: "admin" });

    const settings = await service.updateReviewSettings(
      { id: adminId, role: "admin" },
      { provider: "codex", model: "gpt-5.4" }
    );

    expect(settings).toMatchObject({
      provider: "codex",
      model: "gpt-5.4",
      strategyMode: "project",
      isDefault: false,
      updatedByUserId: adminId
    });
    await expect(service.getEffectiveRuntimeSettings()).resolves.toMatchObject({
      provider: "codex",
      model: "gpt-5.4"
    });

    await db.$disconnect();
  });

  it("rejects non-admin updates and invalid values", async () => {
    const db = await testDb();
    const service = new CodexReviewSettingsService(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "user", role: "user" });

    await expect(
      service.updateReviewSettings({ id: userId, role: "user" }, { provider: "codex", model: "gpt-5.4" })
    ).rejects.toBeInstanceOf(CodexReviewSettingsPermissionError);
    await expect(
      service.updateReviewSettings({ id: userId, role: "admin" }, { provider: "codex", model: " " })
    ).rejects.toBeInstanceOf(CodexReviewSettingsError);

    await db.$disconnect();
  });

  it("verifies and preserves separate OpenAI compatible provider settings", async () => {
    const config = testConfig();
    const db = await testDb(config);
    const verified: unknown[] = [];
    const service = new CodexReviewSettingsService(db, new SecretStore(config), {
      async verify(settings) {
        verified.push(settings);
      }
    });
    const adminId = await insertTestUser(db, { gitlabUserId: 1, username: "admin", role: "admin" });

    const compatible = await service.updateReviewSettings(
      { id: adminId, role: "admin" },
      {
        provider: "openai_compatible",
        baseUrl: "http://qwen.internal:8000",
        model: "qwen-coder",
        contextWindow: 131072,
        apiKey: "secret-key"
      }
    );

    expect(compatible).toMatchObject({
      provider: "openai_compatible",
      model: "qwen-coder",
      codexModel: "gpt-5.5",
      compatible: {
        baseUrl: "http://qwen.internal:8000/v1",
        apiKeyConfigured: true
      }
    });
    expect(verified).toEqual([
      expect.objectContaining({
        provider: "openai_compatible",
        baseUrl: "http://qwen.internal:8000/v1",
        model: "qwen-coder",
        apiKey: "secret-key"
      })
    ]);
    await expect(service.getEffectiveRuntimeSettings()).resolves.toMatchObject({
      provider: "openai_compatible",
      model: "qwen-coder",
      apiKey: "secret-key"
    });

    await service.updateReviewSettings({ id: adminId, role: "admin" }, { provider: "codex", model: "gpt-5.4" });
    await expect(service.getEffectiveReviewSettings(true)).resolves.toMatchObject({
      provider: "codex",
      model: "gpt-5.4",
      compatible: { model: "qwen-coder", apiKeyConfigured: true }
    });
    await db.$disconnect();
  });

  it("does not save compatible settings when verification fails", async () => {
    const config = testConfig();
    const db = await testDb(config);
    const service = new CodexReviewSettingsService(db, new SecretStore(config), {
      async verify() {
        throw new Error("tool call missing");
      }
    });
    const adminId = await insertTestUser(db, { gitlabUserId: 1, username: "admin", role: "admin" });

    await expect(
      service.updateReviewSettings(
        { id: adminId, role: "admin" },
        { provider: "openai_compatible", baseUrl: "http://qwen.internal:8000/v1", model: "qwen", contextWindow: 131072 }
      )
    ).rejects.toThrow("tool call missing");
    await expect(service.getEffectiveReviewSettings()).resolves.toMatchObject({ provider: "codex", model: "gpt-5.5" });
    await db.$disconnect();
  });

  it("preserves, replaces, and removes the compatible API key", async () => {
    const config = testConfig();
    const db = await testDb(config);
    const service = new CodexReviewSettingsService(db, new SecretStore(config), { async verify() {} });
    const adminId = await insertTestUser(db, { gitlabUserId: 1, username: "admin", role: "admin" });
    const base = {
      provider: "openai_compatible" as const,
      baseUrl: "http://qwen.internal:8000/v1",
      model: "qwen",
      contextWindow: 131072
    };

    await service.updateReviewSettings({ id: adminId, role: "admin" }, { ...base, apiKey: "first-key" });
    await service.updateReviewSettings({ id: adminId, role: "admin" }, base);
    await expect(service.getEffectiveRuntimeSettings()).resolves.toMatchObject({ apiKey: "first-key" });

    await service.updateReviewSettings({ id: adminId, role: "admin" }, { ...base, apiKey: "replacement-key" });
    await expect(service.getEffectiveRuntimeSettings()).resolves.toMatchObject({ apiKey: "replacement-key" });

    await service.updateReviewSettings({ id: adminId, role: "admin" }, { ...base, clearApiKey: true });
    await expect(service.getEffectiveRuntimeSettings()).resolves.toMatchObject({ apiKey: null });
    await expect(service.getEffectiveReviewSettings(true)).resolves.toMatchObject({
      compatible: { apiKeyConfigured: false }
    });

    await db.$disconnect();
  });
});
