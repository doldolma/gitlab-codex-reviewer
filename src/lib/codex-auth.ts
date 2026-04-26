import type { CodexAppServerClient } from "./codex-app-server-client";

type LoginResponse =
  | { type: "chatgpt"; loginId: string; authUrl: string }
  | { type: "chatgptDeviceCode"; loginId: string; verificationUrl: string; userCode: string }
  | { type: "apiKey" }
  | { type: "chatgptAuthTokens" };

type AccountResponse = {
  account: null | { type: "apiKey" } | { type: "chatgpt"; email: string; planType: string } | { type: string };
  requiresOpenaiAuth: boolean;
};

export class CodexAuthService {
  constructor(private readonly appServer: CodexAppServerClient) {}

  async startBrowserLogin(): Promise<{ type: "browser"; loginId: string; authUrl: string }> {
    const response = await this.appServer.request<LoginResponse>("account/login/start", { type: "chatgpt" });
    if (response.type !== "chatgpt") {
      throw new Error("Codex did not return a ChatGPT browser login URL");
    }
    return { type: "browser", loginId: response.loginId, authUrl: response.authUrl };
  }

  async startDeviceLogin(): Promise<{ type: "device"; loginId: string; verificationUrl: string; userCode: string }> {
    const response = await this.appServer.request<LoginResponse>("account/login/start", { type: "chatgptDeviceCode" });
    if (response.type !== "chatgptDeviceCode") {
      throw new Error("Codex did not return a ChatGPT device login code");
    }
    return {
      type: "device",
      loginId: response.loginId,
      verificationUrl: response.verificationUrl,
      userCode: response.userCode
    };
  }

  async status() {
    const response = await this.appServer.request<AccountResponse>("account/read", { refreshToken: true });
    const account = response.account;
    return {
      authenticated: Boolean(account),
      requiresOpenaiAuth: response.requiresOpenaiAuth,
      authMode: account?.type ?? null,
      email: isChatGptAccount(account) ? account.email : null,
      planType: isChatGptAccount(account) ? account.planType : null
    };
  }

  async logout(): Promise<void> {
    await this.appServer.request("account/logout");
  }
}

function isChatGptAccount(account: AccountResponse["account"]): account is { type: "chatgpt"; email: string; planType: string } {
  return Boolean(
    account &&
      account.type === "chatgpt" &&
      "email" in account &&
      typeof account.email === "string" &&
      "planType" in account &&
      typeof account.planType === "string"
  );
}
