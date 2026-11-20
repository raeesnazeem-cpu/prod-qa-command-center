-- Step-by-step log of a QA run, so TED's "View run log" panel can show what a
-- run is doing, where it is stuck, and why it failed.
--
-- Written by the API (trigger received, project / URL resolved, could not
-- start, queued) and the worker (run started, each check started / done,
-- report posted, run done / failed, stuck-run sweep). Read by
-- GET /webhooks/ted/runs/:runId/events, /progress and
-- /webhooks/ted/tasks/:taskId/latest-run.
--
--   run_id       the run, or null when no run was created (could not start)
--   ted_task_id  the TED task the trigger was for, so a could-not-start
--                attempt is still findable from the task
--   kind         dotted step name, e.g. trigger.received, check.done
--   status       ok | running | failed | info | warn
--   message      one plain-language line shown in TED
--   detail       extra fields (check name, pages, issues, url, reason, fix)

create table if not exists run_events (
  id          bigserial primary key,
  run_id      uuid null references qa_runs(id) on delete cascade,
  ted_task_id text null,
  at          timestamptz not null default now(),
  kind        text not null,
  status      text not null check (status in ('ok', 'running', 'failed', 'info', 'warn')),
  message     text not null,
  detail      jsonb not null default '{}'::jsonb
);

create index if not exists idx_run_events_run_at on run_events(run_id, at);
create index if not exists idx_run_events_ted_task_at on run_events(ted_task_id, at);

-- Only the service role (API + worker) reads or writes this table.
alter table run_events enable row level security;
