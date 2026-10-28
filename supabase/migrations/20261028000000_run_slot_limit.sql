-- Let up to N QA runs execute at once (was exactly one).
--
-- run_slot_lock had a single row (id = 1). It now holds one row per slot; the
-- caller passes how many slots exist (RUN_SLOT_LIMIT, default 1, so behaviour is
-- unchanged until it is raised). Each worker task on AWS handles one run, and the
-- worker service scales with the number of runs in flight.
--
-- Rules (same as before, per slot):
--   • a run that already holds a slot gets TRUE again (re-entrant / retry);
--   • otherwise it takes the lowest free or stale slot among 1..p_max_slots;
--   • none free → NULL / FALSE, and start_run re-queues itself.
-- Concurrent callers are serialised with a transaction-level advisory lock, so
-- two start_run jobs can never take the same slot or exceed the limit.

alter table public.run_slot_lock drop constraint if exists run_slot_lock_singleton;

drop function if exists public.acquire_run_slot(uuid, integer);

create or replace function public.acquire_run_slot(
  p_run_id uuid,
  p_stale_seconds integer,
  p_max_slots integer default 1
)
returns boolean
language plpgsql
as $$
declare
  v_slot smallint;
begin
  perform pg_advisory_xact_lock(hashtext('qacc_run_slot_lock'));

  update public.run_slot_lock set acquired_at = now() where run_id = p_run_id;
  if found then
    return true;
  end if;

  insert into public.run_slot_lock (id, run_id, acquired_at)
  select g, null, null from generate_series(1, greatest(1, p_max_slots)) g
  on conflict (id) do nothing;

  select id into v_slot
    from public.run_slot_lock
   where id <= greatest(1, p_max_slots)
     and (run_id is null
          or acquired_at < now() - make_interval(secs => p_stale_seconds))
   order by id
   limit 1;

  if v_slot is null then
    return false;
  end if;

  update public.run_slot_lock
     set run_id = p_run_id, acquired_at = now()
   where id = v_slot;
  return true;
end;
$$;

-- Release whichever slot this run holds (a stale-steal by a newer run must not be
-- undone by the crashed run's late release — the run_id match guarantees that).
create or replace function public.release_run_slot(p_run_id uuid)
returns void
language sql
as $$
  update public.run_slot_lock
     set run_id = null, acquired_at = null
   where run_id = p_run_id;
$$;

grant execute on function public.acquire_run_slot(uuid, integer, integer) to service_role, authenticated;
grant execute on function public.release_run_slot(uuid) to service_role, authenticated;
