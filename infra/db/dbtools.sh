#!/usr/bin/env bash
# Entry point of the qacc-dbtools image (infra/db/Dockerfile). Runs as a one-off
# ECS task next to RDS; start it with infra/aws/db-task.sh <command> [args].
#
# Env (set by the qacc-<env>-dbtools task definition):
#   PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSSLMODE  RDS master login
#   AUTHENTICATOR_PASSWORD                                PostgREST's DB login
#   MEDIA_BUCKET MEDIA_PUBLIC_BASE_URL AWS_REGION         media bucket + CDN
#
# Commands:
#   schema                     empty database → full QACC schema (fresh install)
#   restore <s3://…/qacc.dump> load a pg_dump of the old prod DB (data migration)
#   copy-storage               copy every Supabase Storage file into the bucket
#                              (needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY of the OLD project)
#   rewrite-urls <old-supabase-url>  point stored image URLs at the CDN
#   counts                     row count of every table (compare old vs new)
#   sql "<statement>"          run one SQL statement and print the result
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
export PGOPTIONS='-c client_min_messages=warning'
psqlq() { psql -q -X -v ON_ERROR_STOP=1 "$@"; }

prepare() {
  # Roles, auth shim, extensions: safe to re-run.
  if [ "$(psqlq -tA -c "select 1 from pg_roles where rolname = 'authenticator'")" != 1 ]; then
    psqlq -v authenticator_pw="$AUTHENTICATOR_PASSWORD" < "$here/00_roles.sql"
  fi
  psqlq < "$here/01_auth_shim.sql"
  psqlq -v dbname="$PGDATABASE" < "$here/02_extensions.sql"
}

finish() {
  psqlq < "$here/03_grants.sql"
  psqlq -c "notify pgrst, 'reload schema'"
}

cmd="${1:-help}"
shift || true
case "$cmd" in
  schema)
    AUTHENTICATOR_PW="$AUTHENTICATOR_PASSWORD" "$here/load-schema.sh"
    ;;

  restore)
    src="${1:?usage: restore s3://bucket/path/qacc.dump}"
    aws s3 cp --only-show-errors "$src" /tmp/qacc.dump
    prepare
    # Public schema only, no owners/grants from Supabase (plan §8 step 3).
    pg_restore --no-owner --no-privileges --schema=public -d "$PGDATABASE" /tmp/qacc.dump
    # The dump already contains every migration; record them so later ones apply.
    psqlq -c "create schema if not exists infra_meta;
      create table if not exists infra_meta.applied_migrations (
        name text primary key, applied_at timestamptz not null default now())"
    for f in "$repo"/supabase/migrations/*.sql; do
      psqlq -c "insert into infra_meta.applied_migrations(name) values ('$(basename "$f")') on conflict do nothing"
    done
    finish
    rm -f /tmp/qacc.dump
    echo "restore done"
    ;;

  copy-storage)
    node "$here/copy-storage.mjs"
    ;;

  rewrite-urls)
    old="${1:?usage: rewrite-urls https://<project>.supabase.co}"
    PGOPTIONS='-c client_min_messages=notice' psql -q -X -v ON_ERROR_STOP=1 \
      -v old="${old%/}/storage/v1/object/public/" -v new="${MEDIA_PUBLIC_BASE_URL%/}/" \
      < "$here/rewrite-media-urls.sql"
    ;;

  counts)
    psqlq -tA -F $'\t' -c "select table_name from information_schema.tables
              where table_schema = 'public' and table_type = 'BASE TABLE' order by 1" |
      while read -r t; do
        printf '%-32s %s\n' "$t" "$(psqlq -tA -c "select count(*) from public.\"$t\"")"
      done
    ;;

  sql)
    psqlq -c "${1:?usage: sql \"select 1\"}"
    ;;

  *)
    sed -n '2,20p' "$0"
    ;;
esac
