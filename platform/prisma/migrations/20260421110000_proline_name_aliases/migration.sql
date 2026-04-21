ALTER TABLE "SystemConfig"
ADD COLUMN IF NOT EXISTS "prolineNameAliases" JSONB NOT NULL DEFAULT '{}'::jsonb;
