ALTER TABLE pages ADD COLUMN IF NOT EXISTS check_progress JSONB DEFAULT '{}'::jsonb;
