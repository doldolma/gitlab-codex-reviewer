import type { AppConfig } from "./config";
import type { GitLabConnection } from "./gitlab-oauth";
import type { Db } from "./prisma";
import { nowIso } from "./prisma";
import type { SecretStore } from "./secret-store";

type GitLabUserResponse = {
  id: number;
  username: string;
  name?: string;
};

export type ReviewerBotStatus = {
  connected: boolean;
  gitlabHost: string | null;
  botUserId: number | null;
  username: string | null;
  name: string | null;
  lastVerifiedAt: string | null;
};

export class ReviewerBotService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly secrets: SecretStore
  ) {}

  async status(): Promise<ReviewerBotStatus> {
    const row = await this.db.reviewerBotConnection.findFirst({ where: { id: 1 } });
    if (!row) {
      return {
        connected: false,
        gitlabHost: null,
        botUserId: null,
        username: null,
        name: null,
        lastVerifiedAt: null
      };
    }
    return {
      connected: true,
      gitlabHost: row.gitlabHost,
      botUserId: row.botUserId,
      username: row.username,
      name: row.name,
      lastVerifiedAt: row.lastVerifiedAt
    };
  }

  async saveToken(token: string): Promise<ReviewerBotStatus> {
    const trimmed = token.trim();
    if (!trimmed) throw new Error("Reviewer bot token is required");

    const user = await this.fetchUser(trimmed);
    const timestamp = nowIso();
    await this.db.reviewerBotConnection.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        gitlabHost: this.config.gitlab.baseUrl,
        botUserId: user.id,
        username: user.username,
        name: user.name ?? null,
        encryptedToken: this.secrets.encrypt(trimmed),
        createdAt: timestamp,
        updatedAt: timestamp,
        lastVerifiedAt: timestamp
      },
      update: {
        gitlabHost: this.config.gitlab.baseUrl,
        botUserId: user.id,
        username: user.username,
        name: user.name ?? null,
        encryptedToken: this.secrets.encrypt(trimmed),
        updatedAt: timestamp,
        lastVerifiedAt: timestamp
      }
    });
    return this.status();
  }

  async verify(): Promise<ReviewerBotStatus> {
    const row = await this.db.reviewerBotConnection.findFirst({ where: { id: 1 } });
    if (!row) throw new Error("Reviewer bot token is not connected");

    const token = this.secrets.decrypt(row.encryptedToken);
    const user = await this.fetchUser(token);
    const timestamp = nowIso();
    await this.db.reviewerBotConnection.update({
      where: { id: 1 },
      data: {
        botUserId: user.id,
        username: user.username,
        name: user.name ?? null,
        updatedAt: timestamp,
        lastVerifiedAt: timestamp
      }
    });
    return this.status();
  }

  async disconnect(): Promise<void> {
    await this.db.reviewerBotConnection.deleteMany({ where: { id: 1 } });
  }

  async getConnection(): Promise<GitLabConnection | null> {
    const row = await this.db.reviewerBotConnection.findFirst({ where: { id: 1 } });
    if (!row) return null;
    return {
      userId: 0,
      gitlabHost: row.gitlabHost,
      gitlabUserId: row.botUserId,
      username: row.username,
      accessToken: this.secrets.decrypt(row.encryptedToken),
      refreshToken: "",
      expiresAt: "9999-12-31T23:59:59.999Z",
      authType: "private-token"
    };
  }

  private async fetchUser(token: string): Promise<GitLabUserResponse> {
    const response = await fetch(new URL("/api/v4/user", this.config.gitlab.baseUrl), {
      headers: { "PRIVATE-TOKEN": token }
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Reviewer bot token verification failed with ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    return (await response.json()) as GitLabUserResponse;
  }
}
