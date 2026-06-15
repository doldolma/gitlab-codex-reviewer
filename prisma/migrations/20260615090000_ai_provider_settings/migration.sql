ALTER TABLE "codex_review_settings" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'codex';
ALTER TABLE "codex_review_settings" ADD COLUMN "compatible_base_url" TEXT;
ALTER TABLE "codex_review_settings" ADD COLUMN "compatible_model" TEXT;
ALTER TABLE "codex_review_settings" ADD COLUMN "compatible_context_window" INTEGER NOT NULL DEFAULT 131072;
ALTER TABLE "codex_review_settings" ADD COLUMN "compatible_api_key_encrypted" TEXT;
ALTER TABLE "codex_review_settings" ADD COLUMN "compatible_last_verified_at" TEXT;
