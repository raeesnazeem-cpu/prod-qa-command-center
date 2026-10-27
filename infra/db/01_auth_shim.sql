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
