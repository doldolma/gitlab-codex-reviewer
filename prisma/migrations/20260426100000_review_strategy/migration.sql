ALTER TABLE "gitlab_projects" ADD COLUMN "review_strategy" TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE "gitlab_projects" ADD COLUMN "review_strategy_updated_by_user_id" INTEGER;
ALTER TABLE "gitlab_projects" ADD COLUMN "review_strategy_updated_at" TEXT;
