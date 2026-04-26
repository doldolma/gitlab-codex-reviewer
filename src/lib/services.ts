import { CodexAppServerClient } from "./codex-app-server-client";
import { CodexAuthService } from "./codex-auth";
import { loadConfig } from "./config";
import { GitLabOAuthService } from "./gitlab-oauth";
import { prisma } from "./prisma";
import { SecretStore } from "./secret-store";
import { ReviewStateStore } from "./review-state";
import { ReviewWorker } from "../worker/review-worker";
import { UserAdminService } from "./user-admin";
import { ReviewerBotService } from "./reviewer-bot";
import { CodexReviewEngine } from "./review-engine";
import { CodexReviewSettingsService } from "./codex-review-settings";

export const config = loadConfig();
process.env.CODEX_HOME = config.codexHome;

export const secrets = new SecretStore(config);
export const gitlabOAuth = new GitLabOAuthService(prisma, config, secrets);
export const codexAppServer = new CodexAppServerClient(config);
export const codexAuth = new CodexAuthService(codexAppServer);
export const reviewState = new ReviewStateStore(prisma);
export const userAdmin = new UserAdminService(prisma);
export const reviewerBot = new ReviewerBotService(prisma, config, secrets);
export const codexReviewSettings = new CodexReviewSettingsService(prisma);
export const reviewEngine = new CodexReviewEngine({
  codexBin: config.codexBin,
  codexHome: config.codexHome
});
export const reviewWorker = new ReviewWorker(config, gitlabOAuth, reviewState, reviewerBot, reviewEngine, codexReviewSettings);
