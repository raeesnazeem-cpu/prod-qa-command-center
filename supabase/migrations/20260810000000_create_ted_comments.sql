-- Local preview store for TED comments.
--
-- QACC generates the exact HTML it WOULD post to a TED task (per-check report
-- sections, summary comments, status changes) and, while the preview switch in
-- apps/worker/src/lib/tedSync.ts is on, writes that identical payload here
-- INSTEAD of calling TED. The "TED Comments" tab renders these rows exactly as
-- TED renders them, so the wording and layout can be verified before anything
-- ever touches the real TED. This table is NOT synced with TED: deletes and
-- manual comments here are local-only and never reach TED.
CREATE TABLE IF NOT EXISTS ted_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Which project/run this comment belongs to (for grouping in the tab).
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  qa_run_id uuid REFERENCES qa_runs(id) ON DELETE SET NULL,

  -- The TED task/subtask this WOULD have been posted to.
  ted_task_id text,
  target_kind text,              -- 'parent' | 'subtask'
  check_factor text,             -- set when the comment targets a check's subtask

  -- The verbatim payload TED would receive.
  body_html text NOT NULL,
  event_key text,                -- TED idempotency key (null for manual comments)
  source text DEFAULT 'report',  -- 'report' | 'manual' | 'status'
  author text DEFAULT 'QACC',

  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ted_comments_project_id ON ted_comments(project_id);
CREATE INDEX IF NOT EXISTS idx_ted_comments_qa_run_id ON ted_comments(qa_run_id);
CREATE INDEX IF NOT EXISTS idx_ted_comments_created_at ON ted_comments(created_at DESC);

-- Idempotency: report/status writes carry an event_key so re-running a completed
-- run doesn't duplicate rows. Manual comments have event_key = NULL; Postgres
-- treats NULLs as distinct in a unique index, so any number of manual comments
-- coexist. A plain (non-partial) index is required so PostgREST's
-- upsert(onConflict: "event_key") can infer the ON CONFLICT target.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ted_comments_event_key
  ON ted_comments(event_key);

-- The worker/API write with the service role key, which bypasses RLS.
-- Enable RLS and allow authenticated users to read from the app.
ALTER TABLE ted_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "TED comments are readable by authenticated users"
  ON ted_comments FOR SELECT
  TO authenticated
  USING (true);
