CREATE TABLE "review_jobs" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "run_type" TEXT,
    "run_id" INTEGER,
    "payload_json" TEXT NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "started_at" TEXT,
    "finished_at" TEXT,
    CONSTRAINT "review_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_review_jobs_status_created" ON "review_jobs"("status", "created_at");
CREATE INDEX "idx_review_jobs_user" ON "review_jobs"("user_id");
CREATE INDEX "idx_review_jobs_run" ON "review_jobs"("run_type", "run_id");
