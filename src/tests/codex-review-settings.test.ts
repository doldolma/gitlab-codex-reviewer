import { describe, expect, it } from "vitest";
import { CodexReviewSettingsError, CodexReviewSettingsPermissionError, CodexReviewSettingsService } from "../lib/codex-review-settings";
import { insertTestUser, testDb } from "./test-utils";

describe("CodexReviewSettingsService", () => {
  it("returns default review settings when no row exists", async () => {
    const db = await testDb();
    const service = new CodexReviewSettingsService(db);

    await expect(service.getEffectiveReviewSettings()).resolves.toMatchObject({
      model: "gpt-5.5",
      strategyMode: "project",
      isDefault: true
    });

    await db.$disconnect();
  });

  it("allows admins to update instance-wide review settings", async () => {
    const db = await testDb();
    const service = new CodexReviewSettingsService(db);
    const adminId = await insertTestUser(db, { gitlabUserId: 1, username: "admin", role: "admin" });

    const settings = await service.updateReviewSettings(
      { id: adminId, role: "admin" },
      { model: "gpt-5.4" }
    );

    expect(settings).toMatchObject({
      model: "gpt-5.4",
      strategyMode: "project",
      isDefault: false,
      updatedByUserId: adminId
    });
    await expect(service.getEffectiveReviewSettings()).resolves.toMatchObject({
      model: "gpt-5.4"
    });

    await db.$disconnect();
  });

  it("rejects non-admin updates and invalid values", async () => {
    const db = await testDb();
    const service = new CodexReviewSettingsService(db);
    const userId = await insertTestUser(db, { gitlabUserId: 1, username: "user", role: "user" });

    await expect(
      service.updateReviewSettings({ id: userId, role: "user" }, { model: "gpt-5.4" })
    ).rejects.toBeInstanceOf(CodexReviewSettingsPermissionError);
    await expect(
      service.updateReviewSettings({ id: userId, role: "admin" }, { model: " " })
    ).rejects.toBeInstanceOf(CodexReviewSettingsError);

    await db.$disconnect();
  });
});
