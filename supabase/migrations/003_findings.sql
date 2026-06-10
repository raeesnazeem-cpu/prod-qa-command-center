-- ============================================================
-- 003_findings.sql
-- Findings, tasks, rebuttals, comments
-- ============================================================

-- Findings detected on a page
CREATE TABLE findings (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id        uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  run_id         uuid NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE,
  check_factor   text NOT NULL,
  severity       text NOT NULL
                   CHECK (severity IN ('critical','high','medium','low')),
  title          text NOT NULL,
  description    text,
  context_text   text,
  screenshot_url text,
  status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','confirmed','false_positive')),
  ai_generated   boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_findings_page_id  ON findings(page_id);
CREATE INDEX idx_findings_run_id   ON findings(run_id);
CREATE INDEX idx_findings_severity ON findings(severity);
CREATE INDEX idx_findings_status   ON findings(status);

CREATE TRIGGER trg_findings_updated_at
  BEFORE UPDATE ON findings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Tasks created from findings
CREATE TABLE tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id        uuid REFERENCES findings(id) ON DELETE SET NULL,
  project_id        uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title             text NOT NULL,
  description       text,
  severity          text NOT NULL DEFAULT 'medium'
                      CHECK (severity IN ('critical','high','medium','low')),
  status            text NOT NULL DEFAULT 'open'
                      CHECK (status IN ('open','in_progress','resolved','closed')),
  assigned_to       uuid REFERENCES users(id) ON DELETE SET NULL,
  basecamp_task_id  text,
  basecamp_url      text,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_project_id  ON tasks(project_id);
CREATE INDEX idx_tasks_finding_id  ON tasks(finding_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_status      ON tasks(status);

CREATE TRIGGER trg_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Rebuttals submitted by developers on tasks
CREATE TABLE rebuttals (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  submitted_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  text           text NOT NULL,
  screenshot_url text,
  ai_verdict     text
                   CHECK (ai_verdict IN ('resolved','disputed')),
  ai_confidence  int CHECK (ai_confidence BETWEEN 0 AND 100),
  ai_reasoning   text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rebuttals_task_id ON rebuttals(task_id);

-- Comments on tasks (human or AI-generated)
CREATE TABLE comments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id         uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  content         text NOT NULL,
  is_ai_generated boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_comments_task_id ON comments(task_id);
