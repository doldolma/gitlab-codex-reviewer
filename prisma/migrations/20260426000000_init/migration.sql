-- CreateTable
CREATE TABLE "users" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "gitlab_host" TEXT NOT NULL,
    "gitlab_user_id" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT,
    "web_url" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" INTEGER NOT NULL,
    "expires_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "oauth_states" (
    "state" TEXT NOT NULL PRIMARY KEY,
    "code_verifier" TEXT NOT NULL,
    "redirect_to" TEXT,
    "expires_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "gitlab_connection" (
    "user_id" INTEGER NOT NULL PRIMARY KEY,
    "gitlab_host" TEXT NOT NULL,
    "gitlab_user_id" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "encrypted_access_token" TEXT NOT NULL,
    "encrypted_refresh_token" TEXT NOT NULL,
    "expires_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "gitlab_connection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "projects" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "gitlab_project_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "skip_labels_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "merge_requests" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" INTEGER NOT NULL,
    "mr_iid" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "web_url" TEXT NOT NULL,
    "author_username" TEXT,
    "labels_json" TEXT NOT NULL DEFAULT '[]',
    "head_sha" TEXT,
    "state" TEXT NOT NULL,
    "draft" BOOLEAN NOT NULL DEFAULT false,
    "updated_at_gitlab" TEXT,
    "observed_at" TEXT NOT NULL,
    CONSTRAINT "merge_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" INTEGER NOT NULL,
    "mr_iid" INTEGER NOT NULL,
    "head_sha" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TEXT NOT NULL,
    "finished_at" TEXT,
    "comment_id" INTEGER,
    "comment_url" TEXT,
    "findings_markdown" TEXT,
    "error_message" TEXT,
    CONSTRAINT "review_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "review_locks" (
    "lock_key" TEXT NOT NULL PRIMARY KEY,
    "acquired_at" TEXT NOT NULL
);

-- CreateIndex
CREATE INDEX "idx_users_gitlab_identity" ON "users"("gitlab_host", "gitlab_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_gitlab_host_gitlab_user_id_key" ON "users"("gitlab_host", "gitlab_user_id");

-- CreateIndex
CREATE INDEX "idx_projects_user" ON "projects"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_user_id_gitlab_project_id_key" ON "projects"("user_id", "gitlab_project_id");

-- CreateIndex
CREATE INDEX "idx_merge_requests_project" ON "merge_requests"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "merge_requests_project_id_mr_iid_key" ON "merge_requests"("project_id", "mr_iid");

-- CreateIndex
CREATE INDEX "idx_review_runs_status" ON "review_runs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "review_runs_project_id_mr_iid_head_sha_key" ON "review_runs"("project_id", "mr_iid", "head_sha");
