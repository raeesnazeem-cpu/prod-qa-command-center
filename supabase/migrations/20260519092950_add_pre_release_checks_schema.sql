-- Add has_paid_media column to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS has_paid_media BOOLEAN NOT NULL DEFAULT false;

-- Add new check options to the qa_runs enabled_checks validation if there is any (optional, standard jsonb can hold anything)
