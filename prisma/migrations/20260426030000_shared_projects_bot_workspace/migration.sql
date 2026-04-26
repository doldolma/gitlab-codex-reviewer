CREATE TABLE "gitlab_projects" (
  "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
  "gitlab_host" TEXT NOT NULL,
  "gitlab_project_id" TEXT NOT NULL,
  "path_with_namespace" TEXT,
  "name_with_namespace" TEXT,
  "web_url" TEXT,
  "clone_http_url" TEXT,
  "default_branch" TEXT,
  "workspace_error" TEXT,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL
);

CREATE UNIQUE INDEX "gitlab_projects_gitlab_host_gitlab_project_id_key"
  ON "gitlab_projects"("gitlab_host", "gitlab_project_id");
CREATE INDEX "idx_gitlab_projects_host" ON "gitlab_projects"("gitlab_host");

CREATE TABLE "reviewer_bot_connection" (
  "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
  "gitlab_host" TEXT NOT NULL,
  "bot_user_id" INTEGER NOT NULL,
  "username" TEXT NOT NULL,
  "name" TEXT,
  "encrypted_token" TEXT NOT NULL,
  "created_at" TEXT NOT NULL,
  "updated_at" TEXT NOT NULL,
  "last_verified_at" TEXT
);

ALTER TABLE "projects" ADD COLUMN "gitlab_project_ref_id" INTEGER REFERENCES "gitlab_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "merge_requests" ADD COLUMN "gitlab_project_ref_id" INTEGER REFERENCES "gitlab_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_runs" ADD COLUMN "gitlab_project_ref_id" INTEGER REFERENCES "gitlab_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "branch_watch_states" ADD COLUMN "gitlab_project_ref_id" INTEGER REFERENCES "gitlab_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "commit_review_runs" ADD COLUMN "gitlab_project_ref_id" INTEGER REFERENCES "gitlab_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "review_locks" ADD COLUMN "expires_at" TEXT;

INSERT OR IGNORE INTO "gitlab_projects" (
  "gitlab_host",
  "gitlab_project_id",
  "path_with_namespace",
  "name_with_namespace",
  "created_at",
  "updated_at"
)
SELECT
  u."gitlab_host",
  p."gitlab_project_id",
  p."gitlab_project_id",
  p."display_name",
  p."created_at",
  p."updated_at"
FROM "projects" p
JOIN "users" u ON u."id" = p."user_id";

UPDATE "projects"
SET "gitlab_project_ref_id" = (
  SELECT gp."id"
  FROM "gitlab_projects" gp
  JOIN "users" u ON u."id" = "projects"."user_id"
  WHERE gp."gitlab_host" = u."gitlab_host"
    AND gp."gitlab_project_id" = "projects"."gitlab_project_id"
  LIMIT 1
);

UPDATE "merge_requests"
SET "gitlab_project_ref_id" = (
  SELECT p."gitlab_project_ref_id"
  FROM "projects" p
  WHERE p."id" = "merge_requests"."project_id"
  LIMIT 1
);

UPDATE "review_runs"
SET "gitlab_project_ref_id" = (
  SELECT p."gitlab_project_ref_id"
  FROM "projects" p
  WHERE p."id" = "review_runs"."project_id"
  LIMIT 1
);

UPDATE "branch_watch_states"
SET "gitlab_project_ref_id" = (
  SELECT p."gitlab_project_ref_id"
  FROM "projects" p
  WHERE p."id" = "branch_watch_states"."project_id"
  LIMIT 1
);

UPDATE "commit_review_runs"
SET "gitlab_project_ref_id" = (
  SELECT p."gitlab_project_ref_id"
  FROM "projects" p
  WHERE p."id" = "commit_review_runs"."project_id"
  LIMIT 1
);

DELETE FROM "merge_requests"
WHERE "gitlab_project_ref_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT MIN("id")
    FROM "merge_requests"
    WHERE "gitlab_project_ref_id" IS NOT NULL
    GROUP BY "gitlab_project_ref_id", "mr_iid"
  );

DELETE FROM "review_runs"
WHERE "gitlab_project_ref_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT MIN("id")
    FROM "review_runs"
    WHERE "gitlab_project_ref_id" IS NOT NULL
    GROUP BY "gitlab_project_ref_id", "mr_iid", "head_sha"
  );

DELETE FROM "branch_watch_states"
WHERE "gitlab_project_ref_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT MIN("id")
    FROM "branch_watch_states"
    WHERE "gitlab_project_ref_id" IS NOT NULL
    GROUP BY "gitlab_project_ref_id", "branch_name"
  );

DELETE FROM "commit_review_runs"
WHERE "gitlab_project_ref_id" IS NOT NULL
  AND "id" NOT IN (
    SELECT MIN("id")
    FROM "commit_review_runs"
    WHERE "gitlab_project_ref_id" IS NOT NULL
    GROUP BY "gitlab_project_ref_id", "commit_sha"
  );

CREATE INDEX "idx_projects_gitlab_project_ref" ON "projects"("gitlab_project_ref_id");
CREATE INDEX "idx_merge_requests_gitlab_project" ON "merge_requests"("gitlab_project_ref_id");
CREATE INDEX "idx_review_runs_gitlab_project" ON "review_runs"("gitlab_project_ref_id");
CREATE INDEX "idx_branch_watch_states_gitlab_project" ON "branch_watch_states"("gitlab_project_ref_id");
CREATE INDEX "idx_commit_review_runs_gitlab_project" ON "commit_review_runs"("gitlab_project_ref_id");

CREATE UNIQUE INDEX "merge_requests_gitlab_project_ref_id_mr_iid_key"
  ON "merge_requests"("gitlab_project_ref_id", "mr_iid")
  WHERE "gitlab_project_ref_id" IS NOT NULL;

CREATE UNIQUE INDEX "review_runs_gitlab_project_ref_id_mr_iid_head_sha_key"
  ON "review_runs"("gitlab_project_ref_id", "mr_iid", "head_sha")
  WHERE "gitlab_project_ref_id" IS NOT NULL;

CREATE UNIQUE INDEX "branch_watch_states_gitlab_project_ref_id_branch_name_key"
  ON "branch_watch_states"("gitlab_project_ref_id", "branch_name")
  WHERE "gitlab_project_ref_id" IS NOT NULL;

CREATE UNIQUE INDEX "commit_review_runs_gitlab_project_ref_id_commit_sha_key"
  ON "commit_review_runs"("gitlab_project_ref_id", "commit_sha")
  WHERE "gitlab_project_ref_id" IS NOT NULL;
