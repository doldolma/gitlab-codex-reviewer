import { createHash, randomBytes } from "node:crypto";
import type { AppConfig } from "./config";
import type { Db } from "./prisma";
import { nowIso } from "./prisma";
import { normalizeRole, type UserRole } from "./roles";
import type { SecretStore } from "./secret-store";

export type GitLabTokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  created_at?: number;
};

export type GitLabUser = {
  id: number;
  username: string;
  name?: string;
  web_url?: string;
};

export type AppUser = {
  id: number;
  gitlabHost: string;
  gitlabUserId: number;
  username: string;
  name: string | null;
  webUrl: string | null;
  role: UserRole;
};

export type GitLabConnection = {
  userId: number;
  gitlabHost: string;
  gitlabUserId: number;
  username: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  authType?: "bearer" | "private-token";
};

export class GitLabOAuthService {
  constructor(
    private readonly db: Db,
    private readonly config: AppConfig,
    private readonly secrets: SecretStore
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.gitlab.clientId);
  }

  gitlabHost(): string {
    return this.config.gitlab.baseUrl;
  }

  async createAuthorizationUrl(redirectTo?: string): Promise<string> {
    if (!this.config.gitlab.clientId) {
      throw new Error("GITLAB_OAUTH_CLIENT_ID is not configured");
    }

    const state = randomBytes(24).toString("base64url");
    const verifier = randomBytes(64).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await this.db.oauthState.create({
      data: {
        state,
        codeVerifier: verifier,
        redirectTo: redirectTo ?? null,
        expiresAt,
        createdAt
      }
    });

    const url = new URL("/oauth/authorize", this.config.gitlab.baseUrl);
    url.searchParams.set("client_id", this.config.gitlab.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri());
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", state);
    url.searchParams.set("scope", "api");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
    return url.toString();
  }

  async completeCallback(code: string, state: string): Promise<{ user: GitLabUser; token: GitLabTokenResponse; redirectTo: string | null }> {
    const stateRow = await this.db.oauthState.findUnique({ where: { state } });

    if (!stateRow || Date.parse(stateRow.expiresAt) < Date.now()) {
      throw new Error("GitLab OAuth state is invalid or expired");
    }
    await this.db.oauthState.delete({ where: { state } });

    const token = await this.exchangeCode(code, stateRow.codeVerifier);
    const user = await this.fetchUser(token.access_token);
    return { user, token, redirectTo: stateRow.redirectTo };
  }

  async upsertUser(user: GitLabUser): Promise<AppUser> {
    const timestamp = nowIso();
    const identity = {
      gitlabHost: this.config.gitlab.baseUrl,
      gitlabUserId: user.id
    };
    const existing = await this.db.user.findUnique({
      where: {
        gitlabHost_gitlabUserId: identity
      }
    });

    if (existing) {
      const row = await this.db.user.update({
        where: {
          gitlabHost_gitlabUserId: identity
        },
        data: {
          username: user.username,
          name: user.name ?? null,
          webUrl: user.web_url ?? null,
          updatedAt: timestamp
        }
      });
      return userFromRow(row);
    }

    const role = (await this.db.user.count()) === 0 ? "admin" : "user";
    const row = await this.db.user.create({
      data: {
        gitlabHost: this.config.gitlab.baseUrl,
        gitlabUserId: user.id,
        username: user.username,
        name: user.name ?? null,
        webUrl: user.web_url ?? null,
        role,
        createdAt: timestamp,
        updatedAt: timestamp
      },
    });
    return userFromRow(row);
  }

  async saveAuthenticatedConnection(userId: number, user: GitLabUser, token: GitLabTokenResponse): Promise<void> {
    await this.saveConnection(userId, user, token);
  }

  async listConnectedUserIds(): Promise<number[]> {
    const rows = await this.db.gitlabConnection.findMany({
      orderBy: { userId: "asc" },
      select: { userId: true }
    });
    return rows.map((row) => row.userId);
  }

  async getValidConnection(userId: number): Promise<GitLabConnection | null> {
    const row = await this.db.gitlabConnection.findUnique({ where: { userId } });

    if (!row) return null;

    const connection: GitLabConnection = {
      userId: row.userId,
      gitlabHost: row.gitlabHost,
      gitlabUserId: row.gitlabUserId,
      username: row.username,
      accessToken: this.secrets.decrypt(row.encryptedAccessToken),
      refreshToken: this.secrets.decrypt(row.encryptedRefreshToken),
      expiresAt: row.expiresAt
    };

    if (Date.parse(connection.expiresAt) - Date.now() > 60_000) {
      return connection;
    }

    const refreshed = await this.refresh(connection.refreshToken);
    await this.saveConnection(
      connection.userId,
      { id: connection.gitlabUserId, username: connection.username },
      refreshed
    );
    return {
      ...connection,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: expiresAt(refreshed)
    };
  }

  async getConnectionSummary(userId: number) {
    const row = await this.db.gitlabConnection.findUnique({ where: { userId } });
    if (!row) return null;
    return {
      gitlabHost: row.gitlabHost,
      gitlabUserId: row.gitlabUserId,
      username: row.username,
      expiresAt: row.expiresAt
    };
  }

  async logout(userId: number): Promise<void> {
    await this.db.gitlabConnection.deleteMany({ where: { userId } });
  }

  private async exchangeCode(code: string, verifier: string): Promise<GitLabTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.config.gitlab.clientId ?? "",
      code,
      grant_type: "authorization_code",
      redirect_uri: this.redirectUri(),
      code_verifier: verifier
    });
    this.addClientSecret(body);
    return this.postToken(body);
  }

  private async refresh(refreshToken: string): Promise<GitLabTokenResponse> {
    const body = new URLSearchParams({
      client_id: this.config.gitlab.clientId ?? "",
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      redirect_uri: this.redirectUri()
    });
    this.addClientSecret(body);
    return this.postToken(body);
  }

  private async postToken(body: URLSearchParams): Promise<GitLabTokenResponse> {
    const response = await fetch(new URL("/oauth/token", this.config.gitlab.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`GitLab OAuth token request failed with ${response.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
    }
    return (await response.json()) as GitLabTokenResponse;
  }

  private addClientSecret(body: URLSearchParams): void {
    const secret = this.config.gitlab.clientSecret?.trim();
    if (secret) body.set("client_secret", secret);
  }

  private async fetchUser(accessToken: string): Promise<GitLabUser> {
    const response = await fetch(new URL("/api/v4/user", this.config.gitlab.baseUrl), {
      headers: { authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) {
      throw new Error(`GitLab user request failed with ${response.status}`);
    }
    return (await response.json()) as GitLabUser;
  }

  private async saveConnection(userId: number, user: GitLabUser, token: GitLabTokenResponse): Promise<void> {
    const timestamp = nowIso();
    await this.db.gitlabConnection.upsert({
      where: { userId },
      create: {
        userId,
        gitlabHost: this.config.gitlab.baseUrl,
        gitlabUserId: user.id,
        username: user.username,
        encryptedAccessToken: this.secrets.encrypt(token.access_token),
        encryptedRefreshToken: this.secrets.encrypt(token.refresh_token),
        expiresAt: expiresAt(token),
        createdAt: timestamp,
        updatedAt: timestamp
      },
      update: {
        gitlabHost: this.config.gitlab.baseUrl,
        gitlabUserId: user.id,
        username: user.username,
        encryptedAccessToken: this.secrets.encrypt(token.access_token),
        encryptedRefreshToken: this.secrets.encrypt(token.refresh_token),
        expiresAt: expiresAt(token),
        updatedAt: timestamp
      }
    });
  }

  private redirectUri(): string {
    return `${this.config.publicBaseUrl}/api/auth/gitlab/callback`;
  }
}

function expiresAt(token: GitLabTokenResponse): string {
  const baseMs = token.created_at ? token.created_at * 1000 : Date.now();
  return new Date(baseMs + token.expires_in * 1000).toISOString();
}

type UserDbRow = {
  id: number;
  gitlabHost: string;
  gitlabUserId: number;
  username: string;
  name: string | null;
  webUrl: string | null;
  role: string;
};

function userFromRow(row: UserDbRow): AppUser {
  return {
    id: row.id,
    gitlabHost: row.gitlabHost,
    gitlabUserId: row.gitlabUserId,
    username: row.username,
    name: row.name,
    webUrl: row.webUrl,
    role: normalizeRole(row.role)
  };
}
