-- Stand-ins for Supabase's auth.* helpers used by RLS policies (plan §7.10).
-- PostgREST sets request.jwt.claims from the verified JWT.
create schema if not exists auth;

create or replace function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;

create or replace function auth.role() returns text language sql stable as
  $$ select auth.jwt() ->> 'role' $$;

grant usage on schema auth to anon, authenticated, service_role;

-- 001_core_schema.sql has users.id REFERENCES auth.users(id) (dropped later in 011).
create table if not exists auth.users (id uuid primary key);

-- 20260518190700_enable_realtime.sql adds tables to this publication. Realtime is off
-- on AWS (plan D5); an empty publication keeps the migration replayable.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
