-- PostgREST roles (plan §7.10). Run as the RDS master user before restoring data.
-- psql -v authenticator_pw='...' -f 00_roles.sql
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role authenticator login noinherit password :'authenticator_pw';
grant anon, authenticated, service_role to authenticator;
