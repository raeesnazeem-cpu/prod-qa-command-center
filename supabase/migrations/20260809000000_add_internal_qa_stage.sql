-- ============================================================
-- 20260809000000_add_internal_qa_stage.sql
-- Introduce a third project stage: Internal QA.
--
-- Until now a project was effectively binary (is_pre_release vs. is_post_release).
-- The TED internal-QA webhook (beta_site.seo → Completed, target
-- beta_site.internal_test) needs a distinct stage between "just created" and
-- "pre-release": an internal QA pass over the beta site running only the
-- functionality, spelling, and grammar checks.
-- ============================================================

-- 1. Project stage flag. Mutually exclusive with is_pre_release / is_post_release
--    (the webhooks flip the flags on transition).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_internal_qa boolean NOT NULL DEFAULT false;

-- 2. Allow qa_runs.run_type = 'internal_qa'. run_type does not gate check
--    execution (the worker dispatches on enabled_checks); it only labels the
--    run, so widening the CHECK is safe.
ALTER TABLE qa_runs DROP CONSTRAINT IF EXISTS qa_runs_run_type_check;
ALTER TABLE qa_runs
  ADD CONSTRAINT qa_runs_run_type_check
  CHECK (run_type IN ('pre_release', 'post_release', 'internal_qa'));
