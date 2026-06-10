-- Add is_pre_release flag to projects
ALTER TABLE projects ADD COLUMN is_pre_release boolean NOT NULL DEFAULT false;
