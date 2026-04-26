CREATE TABLE "review_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "run_type" TEXT NOT NULL,
    "run_id" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata_json" TEXT NOT NULL DEFAULT '{}',
    "created_at" TEXT NOT NULL
);

CREATE INDEX "idx_review_events_run" ON "review_events"("run_type", "run_id", "created_at");
