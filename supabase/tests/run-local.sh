#!/usr/bin/env bash
# Applies the migrations to a throwaway local Postgres and runs the access-rule
# checks. Needs Postgres server binaries (initdb, pg_ctl) and psql. Touches no
# network and no Supabase project.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bindir="${PG_BINDIR:-$(dirname "$(command -v initdb || ls -d /usr/lib/postgresql/*/bin/initdb | tail -1)")}"
work="$(mktemp -d)"
port="${PGTEST_PORT:-54329}"
cleanup() { "$bindir/pg_ctl" -D "$work/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT
"$bindir/initdb" -D "$work/data" -U postgres -A trust >/dev/null
"$bindir/pg_ctl" -D "$work/data" -o "-p $port -c listen_addresses='' -k $work" -w start >/dev/null
run() { psql -X -q -v ON_ERROR_STOP=1 -h "$work" -p "$port" -U postgres -d postgres -f "$1"; }
run "$here/00_supabase_stub.sql"
for m in "$here"/../migrations/*.sql; do run "$m"; done
run "$here/10_access_rules.sql"
