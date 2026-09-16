-- Fix-phase progress on qa_runs, so TED can poll live progress DURING the AI Fix
-- pass (the scan and fix share ONE qa_runs row; the row's own status stays
-- "completed" from the scan and never reflects the fix). These columns are the
-- only signal that a fix is running and how far along it is.
--
--   ai_fix_status : NULL (no fix yet) | 'queued' | 'running' | 'done' | 'failed'
--   ai_fix_total  : failed checks this fix works on (the scan's open findings,
--                   capped at MAX_FINDINGS=20)
--   ai_fix_done   : findings decided so far — drives the % bar
--   ai_fix_fixed  : edits actually applied/committed (the "8 fixed" tally)
-- notFixed is derived by the reader as ai_fix_total - ai_fix_fixed.

alter table qa_runs
  add column if not exists ai_fix_status text,
  add column if not exists ai_fix_total integer,
  add column if not exists ai_fix_done integer,
  add column if not exists ai_fix_fixed integer,
  add column if not exists ai_fix_started_at timestamptz,
  add column if not exists ai_fix_completed_at timestamptz;
