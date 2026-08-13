-- ============================================================
-- 20260809010000_add_ted_subtask_map_to_qa_runs.sql
-- Per-run mapping of QACC check -> TED subtask id.
--
-- The internal-QA parent task (beta_site.internal_test) has subtasks with no
-- template keys of their own and per-client-varying ids. We discover them at
-- webhook time, map each to a QACC check by title, and store the resulting
-- { check_factor: ted_subtask_id } here so the worker can report each check's
-- result back to its own subtask when the run completes.
-- Additive + idempotent (mirrors ted_report_posted_at).
-- ============================================================
ALTER TABLE qa_runs
  ADD COLUMN IF NOT EXISTS ted_subtask_map jsonb NOT NULL DEFAULT '{}'::jsonb;
