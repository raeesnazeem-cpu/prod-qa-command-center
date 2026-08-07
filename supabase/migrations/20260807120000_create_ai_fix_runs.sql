-- AI Fix module: stores the full categorized dry-run analysis per QA run
-- (every finding: category + proposed fix + whether it was applied/committed).
-- Surfaced in the QACC "Dry-run Data" tab. The worker writes via the service
-- role key (bypasses RLS); authenticated users may read.

CREATE TABLE IF NOT EXISTS ai_fix_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES qa_runs(id) ON DELETE CASCADE,
  project_id uuid,
  run_type text,                 -- pre_release | post_release
  committed integer DEFAULT 0,   -- number of fixes committed/pushed
  commit_url text,               -- link to main commits (when pushed)
  data jsonb,                    -- { repoUrl, findings: [{check_factor,title,pageUrl,category,fix,applied}] }
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_fix_runs_project_created
  ON ai_fix_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_fix_runs_run_id ON ai_fix_runs(run_id);

ALTER TABLE ai_fix_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "AI fix runs are readable by authenticated users"
  ON ai_fix_runs FOR SELECT
  TO authenticated
  USING (true);
