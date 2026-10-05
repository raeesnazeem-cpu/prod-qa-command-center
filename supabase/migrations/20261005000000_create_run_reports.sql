-- The full section-wise report of a run, so TED's Site Audit page can show it.
-- Until now the report only existed as comments posted to TED tasks (built on
-- the fly in tedSync), and a full scan without a task had none at all.
-- Written by the worker (lib/runReport.ts) when a scan (phase 'scan') or an
-- AI-fix pass (phase 'fix') completes; read by
-- GET /webhooks/ted/runs/:runId/report.
--
--   html      the report: title, test-case roll-up, one section per check.
--             Screenshots are links, not inline images, to keep it small.
--   sections  the same per check: [{factor, status, html}]
--   tally     {failed, passed, errored}

create table if not exists run_reports (
  run_id       uuid not null references qa_runs(id) on delete cascade,
  phase        text not null check (phase in ('scan', 'fix')),
  html         text not null,
  sections     jsonb,
  tally        jsonb,
  generated_at timestamptz not null default now(),
  primary key (run_id, phase)
);

-- TED lists finished pre/post-release runs by completion time.
create index if not exists idx_qa_runs_completed_at on qa_runs(completed_at);
