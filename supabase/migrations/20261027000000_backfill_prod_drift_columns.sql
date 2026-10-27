-- Columns that exist on prod (added outside migrations) but that no migration creates,
-- found while replaying migrations onto a fresh Postgres for the AWS move.
-- IF NOT EXISTS keeps this a no-op on prod.

-- TED trigger task id for a run (webhooks write it; worker reads it in start_run,
-- crawl and video jobs; webhooks look runs up by it).
ALTER TABLE qa_runs ADD COLUMN IF NOT EXISTS ted_task_id text;

-- Released/live URL edited from the project form (PATCH /api/projects/:id).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS live_site_url text;
