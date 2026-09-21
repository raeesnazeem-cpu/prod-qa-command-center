-- 20260921000000_add_ted_client_id_to_projects.sql
-- ---------------------------------------------------------------------------
-- Add ted_client_id to `projects` so TED webhooks can resolve a QACC project by
-- the STABLE TED client id instead of by name. TED client names and QACC
-- project names can drift apart (typos, punctuation, re-brands), which made the
-- old name-only match (`ilike(name, clientName)`) fragile. Going forward the
-- webhook matches on ted_client_id first and only falls back to name.
--
-- Backfill: every TED-triggered run already stored (project_id, ted_client_id)
-- on qa_runs (see 20260902000000_add_ted_client_id_to_qa_runs.sql), so the
-- project↔client link already exists in run history — we lift the most recent
-- non-empty value per project. Projects that never had a TED run stay NULL and
-- get their id the first time a TED webhook resolves them by name (the webhook
-- backfills it on a name match).
-- ---------------------------------------------------------------------------

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ted_client_id text;

-- Project resolution runs on every TED webhook event, so index the lookup key.
CREATE INDEX IF NOT EXISTS idx_projects_ted_client_id
  ON projects (ted_client_id);

-- Backfill from qa_runs: for each project without a ted_client_id yet, take the
-- id from its most recent TED-triggered run.
UPDATE projects p
SET ted_client_id = sub.ted_client_id
FROM (
  SELECT DISTINCT ON (project_id)
         project_id,
         ted_client_id
  FROM qa_runs
  WHERE ted_client_id IS NOT NULL
    AND ted_client_id <> ''
  ORDER BY project_id, created_at DESC
) sub
WHERE p.id = sub.project_id
  AND (p.ted_client_id IS NULL OR p.ted_client_id = '');
