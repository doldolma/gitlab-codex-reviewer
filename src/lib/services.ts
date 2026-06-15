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
import { GitLabWebhookService } from "./gitlab-webhooks";
import { CodexReviewTriageEngine } from "./review-triage";
import { CodexReleaseNoteEngine } from "./release-note-engine";
import { OpenAICompatibleConnectionVerifier } from "./openai-compatible-verifier";
import { OpenAICompatibleReviewEngine } from "./openai-compatible-review-engine";
import { ProviderReviewer } from "./provider-reviewer";

export const config = loadConfig();
process.env.CODEX_HOME = config.codexHome;

export const secrets = new SecretStore(config);
export const gitlabOAuth = new GitLabOAuthService(prisma, config, secrets);
export const codexAppServer = new CodexAppServerClient(config);
export const codexAuth = new CodexAuthService(codexAppServer);
export const reviewState = new ReviewStateStore(prisma);
export const userAdmin = new UserAdminService(prisma);
export const reviewerBot = new ReviewerBotService(prisma, config, secrets);
export const gitlabWebhooks = new GitLabWebhookService(config, reviewState, reviewerBot, secrets);
export const compatibleProviderVerifier = new OpenAICompatibleConnectionVerifier();
export const codexReviewSettings = new CodexReviewSettingsService(prisma, secrets, compatibleProviderVerifier);
export const codexReviewEngine = new CodexReviewEngine({
  codexBin: config.codexBin,
  codexHome: config.codexHome,
  sandboxMode: config.codexSandboxMode
});
export const compatibleReviewEngine = new OpenAICompatibleReviewEngine();
export const reviewEngine = new ProviderReviewer(codexReviewEngine, compatibleReviewEngine);
export const reviewTriageEngine = new CodexReviewTriageEngine({
  codexBin: config.codexBin,
  codexHome: config.codexHome,
  sandboxMode: config.codexSandboxMode
});
export const releaseNoteEngine = new CodexReleaseNoteEngine({
  codexBin: config.codexBin,
  codexHome: config.codexHome,
  sandboxMode: config.codexSandboxMode
});
export const reviewWorker = new ReviewWorker(
  config,
  gitlabOAuth,
  reviewState,
  reviewerBot,
  reviewEngine,
  reviewTriageEngine,
  codexReviewSettings,
  undefined,
  releaseNoteEngine
);
