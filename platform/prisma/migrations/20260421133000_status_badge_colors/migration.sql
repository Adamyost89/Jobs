ALTER TABLE "SystemConfig"
ADD COLUMN IF NOT EXISTS "statusBadgeColors" JSONB NOT NULL DEFAULT '{}'::jsonb;
