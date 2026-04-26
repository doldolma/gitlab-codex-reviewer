ALTER TABLE "projects" ADD COLUMN "mr_target_branches_json" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "projects" ADD COLUMN "commit_branches_json" TEXT NOT NULL DEFAULT '[]';

CREATE TABLE "branch_watch_states" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "project_id" INTEGER NOT NULL,
    "branch_name" TEXT NOT NULL,
    "last_seen_sha" TEXT,
    "last_error" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "branch_watch_states_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "commit_review_runs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "project_id" INTEGER,
    "gitlab_project_id" TEXT NOT NULL,
    "branch_name" TEXT,
    "commit_sha" TEXT NOT NULL,
    "commit_title" TEXT NOT NULL,
    "commit_url" TEXT,
    "author_name" TEXT,
    "committed_date" TEXT,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TEXT NOT NULL,
    "finished_at" TEXT,
    "comment_id" INTEGER,
    "comment_url" TEXT,
    "findings_markdown" TEXT,
    "error_message" TEXT,
    CONSTRAINT "commit_review_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "commit_review_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "branch_watch_states_project_id_branch_name_key" ON "branch_watch_states"("project_id", "branch_name");
CREATE INDEX "idx_branch_watch_states_project" ON "branch_watch_states"("project_id");
CREATE UNIQUE INDEX "commit_review_runs_user_id_gitlab_project_id_commit_sha_key" ON "commit_review_runs"("user_id", "gitlab_project_id", "commit_sha");
CREATE INDEX "idx_commit_review_runs_user" ON "commit_review_runs"("user_id");
CREATE INDEX "idx_commit_review_runs_project" ON "commit_review_runs"("project_id");
CREATE INDEX "idx_commit_review_runs_status" ON "commit_review_runs"("status");
