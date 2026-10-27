-- Extensions the schema needs (plan §7.10). pgvector comes from the pgvector/pgvector image.
-- vector lives in public like on prod Supabase (migrations reference public.vector).
create schema if not exists extensions;
create extension if not exists vector schema public;
do $$ begin
  if (select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace
      where e.extname = 'vector') <> 'public' then
    alter extension vector set schema public;
  end if;
end $$;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;

grant usage on schema extensions to anon, authenticated, service_role;
-- Supabase puts extensions on everyone's search_path; migrations use bare `vector(768)`.
-- :"dbname" is passed by load-schema.sh.
alter database :"dbname" set search_path = "$user", public, extensions;
alter role authenticator set search_path = public, extensions;
