-- Stuck-at-99% fix: make run completion reconcile against the real page rows,
-- not a hand-maintained counter that can drift.
--
-- Background. A full/pre/post-release run finishes when every page it enqueued
-- reaches a terminal state. Completion was gated on `pages_processed`, an
-- integer bumped +1 in each crawl_page job's `finally`. If even one increment is
-- lost — a worker restart/OOM between "mark page done" and the increment, an
-- override retry, or the increment RPC failing while its fallback also missed —
-- the counter sits one (or more) below `pages_total` forever. The gate
-- `pages_processed >= pages_total` then never becomes true, the run never flips
-- to `completed`, and `/progress` reports round(processed/total) — stuck at
-- ~99% with `done:false` for the life of the run. Observed in prod on a run
-- whose 54 pages were ALL `done` while the counter read 53.
--
-- The page rows are the source of truth ('done' on success, 'failed' when the
-- job gives up — both terminal, both mean "this page will not be worked again").
-- So both functions below derive progress from an actual COUNT of terminal pages
-- instead of trusting the counter.

-- 1) The per-page completion RPC, hardened. Still increments (so a healthy run
--    is unchanged), but pins `pages_processed` to at least the real terminal
--    count via GREATEST — so a drifted counter self-heals the next time ANY page
--    of the run finishes, and the completion gate reflects reality.
create or replace function public.increment_and_check_completion(run_id_param uuid)
returns boolean
language plpgsql
as $$
declare
  v_processed integer;
  v_total integer;
  v_status text;
  v_done integer;
begin
  select count(*) into v_done
  from public.pages
  where run_id = run_id_param and status in ('done', 'failed');

  update public.qa_runs
  set pages_processed = greatest(coalesce(pages_processed, 0) + 1, v_done)
  where id = run_id_param
  returning pages_processed, pages_total, status into v_processed, v_total, v_status;

  if v_status = 'running' and v_total > 0 and v_processed >= v_total then
    update public.qa_runs
    set status = 'completed', completed_at = now()
    where id = run_id_param and status = 'running';
    return true;
  end if;

  return false;
end;
$$;

-- 2) A standalone reconcile the sweeper calls for runs whose per-page finallys
--    will never fire again (the exact prod incident). Purely count-based: it
--    completes a still-'running' run only when every page is terminal. The
--    `where ... status = 'running'` guard makes it atomic — of several callers
--    (a late page finally, another worker, this sweeper) exactly one wins, and
--    `FOUND` tells that winner to run the recovery side-effects (report, slot).
create or replace function public.reconcile_run_completion(run_id_param uuid)
returns boolean
language plpgsql
as $$
declare
  v_total integer;
  v_status text;
  v_done integer;
begin
  select pages_total, status into v_total, v_status
  from public.qa_runs
  where id = run_id_param;

  if v_status is distinct from 'running' or coalesce(v_total, 0) <= 0 then
    return false;
  end if;

  select count(*) into v_done
  from public.pages
  where run_id = run_id_param and status in ('done', 'failed');

  if v_done < v_total then
    return false;
  end if;

  update public.qa_runs
  set status = 'completed',
      completed_at = now(),
      pages_processed = greatest(coalesce(pages_processed, 0), v_done)
  where id = run_id_param and status = 'running';

  return found;
end;
$$;

grant execute on function public.reconcile_run_completion(uuid) to anon, authenticated, service_role;
