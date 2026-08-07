-- Idempotency marker for the TED final-report comment.
-- A QA run can be finalized by several independent worker code paths
-- (runChecksJob RPC path + fallback, crawlPageJob RPC path + fallback, etc.).
-- To guarantee the completion report is posted to TED exactly ONCE, the worker
-- atomically "claims" the run by stamping this column before posting; only the
-- first claimer posts. Nullable + additive: no effect on existing rows/logic.
ALTER TABLE qa_runs ADD COLUMN IF NOT EXISTS ted_report_posted_at timestamptz;
