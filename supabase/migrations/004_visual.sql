-- ============================================================
-- 004_visual.sql
-- Visual diff comparisons, sign-offs, project settings
-- ============================================================

-- Visual diffs between Figma designs and live screenshots
CREATE TABLE visual_diffs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id                uuid NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE,
  page_id               uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  figma_screenshot_url  text,
  site_screenshot_url   text,
  ai_summary            jsonb,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_visual_diffs_run_id  ON visual_diffs(run_id);
CREATE INDEX idx_visual_diffs_page_id ON visual_diffs(page_id);

-- Sign-offs on completed QA runs
CREATE TABLE sign_offs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     uuid NOT NULL REFERENCES qa_runs(id) ON DELETE CASCADE,
  signed_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  notes      text,
  signed_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sign_offs_run_id ON sign_offs(run_id);

-- Per-project settings (integrations, tokens, notification prefs)
CREATE TABLE project_settings (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                 uuid NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  figma_token_encrypted      text,
  basecamp_token_encrypted   text,
  basecamp_account_id        text,
  basecamp_project_id        text,
  basecamp_todolist_id       text,
  slack_webhook_url          text,
  notification_prefs         jsonb NOT NULL DEFAULT '{}',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_project_settings_updated_at
  BEFORE UPDATE ON project_settings
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
