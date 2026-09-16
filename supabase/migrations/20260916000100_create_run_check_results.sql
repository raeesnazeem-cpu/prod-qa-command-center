-- Per-check result snapshot for a run, so the TED Site Audit history can render
-- each run's per-check pass/fail with a message, screenshot and duration WITHOUT
-- re-deriving it (today that derivation is ephemeral and per-check timings live
-- only in worker memory). Written once by the worker when a scan (phase 'scan')
-- or a fix (phase 'fix') completes; read by the TED-facing /result endpoint.
--
-- One row per (run_id, phase, check_factor) — aggregated across pages:
--   status  scan: 'passed' | 'failed' | 'errored'
--           fix:  'fixed'  | 'not_fixed'
--   message first real defect's title/description (fail reason), or fix note
--   duration_ms  summed wall-clock for that check (checks run concurrently, so
--                this is per-check work time, not a slice of the run total)

create table if not exists run_check_results (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references qa_runs(id) on delete cascade,
  phase          text not null check (phase in ('scan', 'fix')),
  check_factor   text not null,
  label          text,
  status         text not null,
  duration_ms    integer,
  message        text,
  page_url       text,
  screenshot_url text,
  severity       text,
  created_at     timestamptz not null default now(),
  unique (run_id, phase, check_factor)
);

create index if not exists idx_run_check_results_run on run_check_results(run_id);
