-- Extensions the schema needs (plan §7.10). pgvector comes from the pgvector/pgvector image.
create schema if not exists extensions;
create extension if not exists vector schema extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;

grant usage on schema extensions to anon, authenticated, service_role;
alter role authenticator set search_path = public, extensions;
