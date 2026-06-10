-- Add unique constraint to prevent duplicate project names within an organization
ALTER TABLE projects ADD CONSTRAINT unique_project_name_per_org UNIQUE (org_id, name);
