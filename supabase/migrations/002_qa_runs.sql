-- ============================================================
-- 002_qa_runs.sql
-- QA run execution tables: qa_runs, pages
-- ============================================================

-- QA Runs
CREATE TABLE qa_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  run_type           text NOT NULL
                       CHECK (run_type IN ('pre_release','post_release')),
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','running','completed','failed','timed_out')),
  site_url           text NOT NULL,
  figma_url          text,
  pages_total        int NOT NULL DEFAULT 0,
  pages_processed    int NOT NULL DEFAULT 0,
  enabled_checks     jsonb NOT NULL DEFAULT '[]',
  is_woocommerce     boolean NOT NULL DEFAULT false,
  started_at         timestamptz,
  completed_at       timestamptz,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_qa_runs_project_id  ON qa_runs(project_id);
CREATE INDEX idx_qa_runs_status      ON qa_runs(status);
CREATE INDEX idx_qa_runs_created_by  ON qa_runs(created_by);

CREATE TRIGGER trg_qa_runs_updated_at
  BEFORE UPDATE ON qa_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Pages crawled during a run
CREATE TABLE pages (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                    uuid NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE,
  url                       text NOT NULL,
  title                     text,
  status                    text NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','processing','done','error')),
  screenshot_url_desktop    text,
  screenshot_url_tablet     text,
  screenshot_url_mobile     text,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_pages_run_id ON pages(run_id);
CREATE INDEX idx_pages_status ON pages(status);
