ALTER TABLE "gitlab_projects" ADD COLUMN "webhook_hook_id" INTEGER;
ALTER TABLE "gitlab_projects" ADD COLUMN "webhook_secret_encrypted" TEXT;
ALTER TABLE "gitlab_projects" ADD COLUMN "webhook_url" TEXT;
ALTER TABLE "gitlab_projects" ADD COLUMN "webhook_last_verified_at" TEXT;
ALTER TABLE "gitlab_projects" ADD COLUMN "webhook_error" TEXT;
