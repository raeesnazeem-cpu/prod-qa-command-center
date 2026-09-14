-- ============================================================
-- 20260914000000_add_full_scan_run_type.sql
-- Introduce a fourth run type: Full Scan.
--
-- Full Scan is a standalone, TED-triggered QA pass: an operator opens a TED
-- project, enters a site URL, and clicks Scan. QACC runs the ENTIRE check suite
-- (a superset of pre/internal/post) against that one URL and posts a single
-- timestamped report to the project's release.qa_post parent task. It is
-- deliberately ad-hoc — it may run any number of times a day and NEVER changes
-- the post-release task's status (unlike the three stage-bound run types).
--
-- Like internal_qa before it, run_type does NOT gate check execution (the worker
-- dispatches on enabled_checks); it only labels the run and switches on the
-- Test/Fix-split reporting behaviour, so widening the CHECK is safe and additive.
-- Mirrors 20260809000000_add_internal_qa_stage.sql.
-- ============================================================

ALTER TABLE qa_runs DROP CONSTRAINT IF EXISTS qa_runs_run_type_check;
ALTER TABLE qa_runs
  ADD CONSTRAINT qa_runs_run_type_check
  CHECK (run_type IN ('pre_release', 'post_release', 'internal_qa', 'full_scan'));
