-- ============================================================
-- 20260902000000_add_ted_client_id_to_qa_runs.sql
-- Store the TED client id on the run at scan start.
--
-- The AI-fix pass resolves the client's beta_site.env repo. It used to look the
-- client up by the QACC project NAME (resolveBetaSiteRepo(project.name)), which
-- fails whenever the project name doesn't equal the TED client name (e.g. the
-- synthetic test client "QACC TED Test 1534") — getClient() returns null, the
-- beta_site.env task is never read, and the fix reports "no repo URL" even when
-- the repo IS present on the task.
--
-- The webhook already knows the real TED clientId (it resolves the beta site URL
-- with it). We persist that id here so the worker can resolve the repo by the
-- exact key instead of a fuzzy name match.
-- Additive + idempotent (mirrors ted_subtask_map / ted_report_posted_at).
-- ============================================================
ALTER TABLE qa_runs
  ADD COLUMN IF NOT EXISTS ted_client_id text;
