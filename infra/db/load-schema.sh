#!/usr/bin/env bash
# Build the QACC schema on a plain Postgres (floci RDS or real RDS), plan §7.10 / Phase 2.
#   1. 00_roles, 01_auth_shim, 02_extensions (once; idempotent where possible)
#   2. supabase/migrations/*.sql in filename order, each in one transaction,
#      recorded in infra_meta.applied_migrations so re-runs skip what's done
#   3. 03_grants
#
# Env: PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE AUTHENTICATOR_PW
# Default runs psql in a container on the floci network (PSQL_DOCKER=1).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
: "${PGHOST:=floci}" "${PGPORT:=7001}" "${PGUSER:=qaccadmin}" "${PGDATABASE:=qacc}"
: "${PGPASSWORD:?set PGPASSWORD}" "${AUTHENTICATOR_PW:?set AUTHENTICATOR_PW}"
: "${PSQL_DOCKER:=1}"

psql_run() {
  if [ "$PSQL_DOCKER" = 1 ]; then
    docker run --rm -i --network qacc-floci -e PGPASSWORD -e PGOPTIONS='-c client_min_messages=warning' \
      pgvector/pgvector:pg16 psql -q -X -v ON_ERROR_STOP=1 \
      -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" "$@"
  else
    PGOPTIONS='-c client_min_messages=warning' psql -q -X -v ON_ERROR_STOP=1 "$@"
  fi
}

has_role=$(psql_run -tA -c "select 1 from pg_roles where rolname = 'authenticator'")
if [ "$has_role" != 1 ]; then
  psql_run -v authenticator_pw="$AUTHENTICATOR_PW" < "$here/00_roles.sql"
fi
psql_run < "$here/01_auth_shim.sql"
psql_run -v dbname="$PGDATABASE" < "$here/02_extensions.sql"

psql_run -c "create schema if not exists infra_meta;
  create table if not exists infra_meta.applied_migrations (
    name text primary key, applied_at timestamptz not null default now())"
applied=$(psql_run -tA -c "select name from infra_meta.applied_migrations")

for f in $(ls "$repo"/supabase/migrations/*.sql | sort); do
  name=$(basename "$f")
  if grep -qxF "$name" <<<"$applied"; then continue; fi
  { cat "$f"; echo; echo "insert into infra_meta.applied_migrations(name) values ('$name');"; } \
    | psql_run --single-transaction \
    || { echo "FAILED: $name" >&2; exit 1; }
  echo "applied $name"
done

psql_run < "$here/03_grants.sql"
# PostgREST caches the schema; tell running instances to reload.
psql_run -c "notify pgrst, 'reload schema'"
echo "schema ready"
