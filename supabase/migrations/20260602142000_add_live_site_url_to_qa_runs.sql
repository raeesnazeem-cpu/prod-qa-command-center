-- Add live_site_url column to qa_runs table
ALTER TABLE qa_runs ADD COLUMN IF NOT EXISTS live_site_url TEXT;
