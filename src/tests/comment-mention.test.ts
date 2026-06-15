import { describe, expect, it } from "vitest";
import { mentionsBot } from "../lib/gitlab-webhooks";

describe("mentionsBot", () => {
  const bot = "reviewer-bot";

  it("matches a direct mention", () => {
    expect(mentionsBot("@reviewer-bot please explain this", bot)).toBe(true);
    expect(mentionsBot("hey @reviewer-bot", bot)).toBe(true);
    expect(mentionsBot("@reviewer-bot, why is this risky?", bot)).toBe(true);
    expect(mentionsBot("ping @reviewer-bot.", bot)).toBe(true); // trailing sentence period
  });

  it("does not match a different (longer) username", () => {
    expect(mentionsBot("ping @reviewer-bot2 here", bot)).toBe(false);
    expect(mentionsBot("see @reviewer-bottle", bot)).toBe(false);
  });

  it("does not match when the bot is not mentioned", () => {
    expect(mentionsBot("this is just a normal comment", bot)).toBe(false);
    expect(mentionsBot("reviewer-bot without the @ sign", bot)).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(mentionsBot("@Reviewer-Bot help", bot)).toBe(true);
  });
});
