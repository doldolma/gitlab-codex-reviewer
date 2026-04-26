import { describe, expect, it } from "vitest";
import { SecretStore } from "../lib/secret-store";
import { testConfig } from "./test-utils";

describe("SecretStore", () => {
  it("encrypts and decrypts values without storing plaintext", () => {
    const store = new SecretStore(testConfig());
    const encrypted = store.encrypt("token-value");

    expect(encrypted).not.toContain("token-value");
    expect(store.decrypt(encrypted)).toBe("token-value");
  });
});
