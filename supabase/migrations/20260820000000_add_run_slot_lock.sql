-- Global "one QA run at a time" lock.
--
-- QACC must not run two QA runs concurrently (browser scans, repo clone/push,
-- and TED writes all compete). This adds a single-row lock that start_run must
-- claim before a run may begin. The acquire is ATOMIC (INSERT ... ON CONFLICT
-- DO UPDATE ... WHERE), so two start_run jobs racing can never both win.
--
-- A staleness window is the backstop: if a run crashes without releasing, the
-- next acquirer may steal the slot once acquired_at is older than the caller's
-- p_stale_seconds. Callers pass a window comfortably larger than a normal run.

create table if not exists public.run_slot_lock (
  id smallint primary key default 1,
  run_id uuid,
  acquired_at timestamptz,
  constraint run_slot_lock_singleton check (id = 1)
);

-- Seed the single row (free) once.
insert into public.run_slot_lock (id, run_id, acquired_at)
values (1, null, null)
on conflict (id) do nothing;

-- Atomically claim the slot. Returns TRUE only when this run now holds it:
--   • free (run_id is null), or
--   • already held by this same run (re-entrant / retry), or
--   • the current holder is stale (older than p_stale_seconds).
-- When the slot is held by another, fresh run, the ON CONFLICT WHERE is false,
-- no row is updated, nothing is returned, and the function yields NULL (treated
-- as "not acquired" by the caller).
create or replace function public.acquire_run_slot(
  p_run_id uuid,
  p_stale_seconds integer
)
returns boolean
language sql
as $$
  insert into public.run_slot_lock (id, run_id, acquired_at)
  values (1, p_run_id, now())
  on conflict (id) do update
    set run_id = excluded.run_id,
        acquired_at = excluded.acquired_at
    where public.run_slot_lock.run_id is null
       or public.run_slot_lock.run_id = p_run_id
       or public.run_slot_lock.acquired_at
            < now() - make_interval(secs => p_stale_seconds)
  returning (run_slot_lock.run_id = p_run_id);
$$;

-- Release the slot, but only if this run still owns it (a stale-steal by a
-- newer run must not be undone by the crashed run's late release).
create or replace function public.release_run_slot(p_run_id uuid)
returns void
language sql
as $$
  update public.run_slot_lock
     set run_id = null, acquired_at = null
   where id = 1 and run_id = p_run_id;
$$;

grant execute on function public.acquire_run_slot(uuid, integer) to service_role, authenticated;
grant execute on function public.release_run_slot(uuid) to service_role, authenticated;
