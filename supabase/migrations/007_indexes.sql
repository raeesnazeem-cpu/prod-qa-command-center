-- 007_indexes.sql
-- Adding performance indexes for common query patterns

CREATE INDEX IF NOT EXISTS idx_findings_run_id ON findings(run_id);
CREATE INDEX IF NOT EXISTS idx_findings_page_id ON findings(page_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON findings(status);

CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id);

CREATE INDEX IF NOT EXISTS idx_pages_run_id ON pages(run_id);

CREATE INDEX IF NOT EXISTS idx_comments_task_id ON comments(task_id);
