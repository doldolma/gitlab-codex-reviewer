ALTER TABLE "gitlab_projects" ADD COLUMN "review_profile" TEXT NOT NULL DEFAULT 'assertive';
ALTER TABLE "gitlab_projects" ADD COLUMN "path_filters_json" TEXT NOT NULL DEFAULT '[]';

ALTER TABLE "review_runs" ADD COLUMN "structured_review_json" TEXT;
ALTER TABLE "commit_review_runs" ADD COLUMN "structured_review_json" TEXT;

CREATE TABLE "project_review_instructions" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "gitlab_project_ref_id" INTEGER NOT NULL,
  "path_glob" TEXT NOT NULL,
  "instructions" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  CONSTRAINT "project_review_instructions_gitlab_project_ref_id_fkey" FOREIGN KEY ("gitlab_project_ref_id") REFERENCES "gitlab_projects" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_project_review_instructions_project" ON "project_review_instructions"("gitlab_project_ref_id");

CREATE TABLE "review_feedback" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "user_id" INTEGER NOT NULL,
  "run_type" TEXT NOT NULL,
  "run_id" INTEGER NOT NULL,
  "issue_fingerprint" TEXT NOT NULL,
  "rating" TEXT NOT NULL,
  "note" TEXT,
  "created_at" TEXT NOT NULL,
  CONSTRAINT "review_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uniq_review_feedback_user_issue" ON "review_feedback"("user_id", "run_type", "run_id", "issue_fingerprint");
CREATE INDEX "idx_review_feedback_run" ON "review_feedback"("run_type", "run_id");
