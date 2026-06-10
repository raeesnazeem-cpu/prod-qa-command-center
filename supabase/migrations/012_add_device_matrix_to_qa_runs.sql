-- Add device_matrix column to qa_runs
ALTER TABLE qa_runs ADD COLUMN IF NOT EXISTS device_matrix jsonb NOT NULL DEFAULT '["desktop"]';
