-- Idempotency claim for TED "Completed" status writes.
-- markAllTedTasksCompleted() is reachable from several uncoordinated completion
-- paths (crawlPageJob's module-off + all-passed branches, aiFixRunJob's no-repo
-- early return + end-of-pass) and via BullMQ retries. In real-TED mode each call
-- was a fresh status PUT, so TED logged a duplicate "status changed → Completed"
-- on the main thread every time. This column lets exactly ONE caller win the
-- claim (atomic UPDATE ... WHERE ted_completed_at IS NULL) and post the status
-- once per run; every later caller no-ops. Mirrors ted_report_posted_at.
alter table qa_runs
  add column if not exists ted_completed_at timestamptz;
