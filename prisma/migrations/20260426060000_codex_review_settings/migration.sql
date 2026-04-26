CREATE TABLE "codex_review_settings" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "model" TEXT NOT NULL,
    "reasoning_effort" TEXT NOT NULL,
    "updated_by_user_id" INTEGER,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);
