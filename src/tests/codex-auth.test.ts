import { describe, expect, it } from "vitest";
import { CodexAuthService } from "../lib/codex-auth";
import type { CodexAppServerClient } from "../lib/codex-app-server-client";

describe("CodexAuthService", () => {
  it("starts a ChatGPT device-code login", async () => {
    const requests: unknown[] = [];
    const appServer = {
      request: async <T>(method: string, params: unknown) => {
        requests.push({ method, params });
        return {
          type: "chatgptDeviceCode",
          loginId: "login-1",
          verificationUrl: "https://auth.openai.com/codex/device",
          userCode: "ABCD-1234"
        } as T;
      }
    } as unknown as CodexAppServerClient;
    const auth = new CodexAuthService(appServer);

    await expect(auth.startDeviceLogin()).resolves.toEqual({
      type: "device",
      loginId: "login-1",
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-1234"
    });
    expect(requests).toEqual([{ method: "account/login/start", params: { type: "chatgptDeviceCode" } }]);
  });

  it("keeps browser login available as a fallback flow", async () => {
    const appServer = {
      request: async <T>() =>
        ({
          type: "chatgpt",
          loginId: "login-2",
          authUrl: "https://auth.openai.com/oauth/authorize"
        }) as T
    } as unknown as CodexAppServerClient;
    const auth = new CodexAuthService(appServer);

    await expect(auth.startBrowserLogin()).resolves.toEqual({
      type: "browser",
      loginId: "login-2",
      authUrl: "https://auth.openai.com/oauth/authorize"
    });
  });

  it("treats an existing ChatGPT account as authenticated even when app-server reports requiresOpenaiAuth", async () => {
    const appServer = {
      request: async <T>() => ({
        account: {
          type: "chatgpt",
          email: "user@example.com",
          planType: "pro"
        },
        requiresOpenaiAuth: true
      }) as T
    } as unknown as CodexAppServerClient;
    const auth = new CodexAuthService(appServer);

    await expect(auth.status()).resolves.toMatchObject({
      authenticated: true,
      requiresOpenaiAuth: true,
      authMode: "chatgpt",
      email: "user@example.com",
      planType: "pro"
    });
  });
});
