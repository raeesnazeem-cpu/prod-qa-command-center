-- Add progress and current_step to pages
ALTER TABLE pages ADD COLUMN IF NOT EXISTS progress int DEFAULT 0;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS current_step text;
