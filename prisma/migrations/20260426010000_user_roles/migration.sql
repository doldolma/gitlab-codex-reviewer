-- Add app-local roles. Existing installs promote the oldest known user to admin.
ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

UPDATE "users"
SET "role" = 'admin'
WHERE "id" = (
  SELECT "id"
  FROM "users"
  ORDER BY "created_at" ASC, "id" ASC
  LIMIT 1
);
