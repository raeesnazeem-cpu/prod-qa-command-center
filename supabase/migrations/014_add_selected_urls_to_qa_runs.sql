-- Add selected_urls to qa_runs
ALTER TABLE qa_runs ADD COLUMN IF NOT EXISTS selected_urls text[];
