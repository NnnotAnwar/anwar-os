#!/usr/bin/env bash
# The restore drill: restore an encrypted backup into a THROWAWAY Postgres
# (a container of its own, never the stack's), check what came back, report.
#
#   infra/backup/drill.sh --from-app [--migrate] [--test-db] [--report]
#   infra/backup/drill.sh --file b.dump.age -i key.txt [--previous prev.json] [--out r.json]
#   infra/backup/drill.sh --self-test
#
# Monthly in GitHub Actions (.github/workflows/restore-drill.yml), by hand
# anywhere with Docker, age, jq, curl and python3. docs/DEPLOY.md, "Restore drill".
#
# Where the backup comes from
#   --from-app        ask anwar.os for a 15-minute link to the newest daily
#                     backup (POST /api/ops/restore-drill/source, signed with
#                     RESTORE_DRILL_SECRET; DRILL_APP_URL, e.g. https://anwar-os.com).
#                     The app also returns the last good drill's row counts.
#   --file PATH       a local .dump.age instead
#   --previous FILE   with --file: {"tables": {...}, "totalRows": n} to compare with
# Decryption
#   -i, --identity F  age identity file; or DRILL_AGE_IDENTITY (the key itself,
#                     as the GitHub secret holds it) or AGE_IDENTITY_FILE
# After the checks
#   --migrate         apply the repo's newer migrations to the restored copy (pnpm db:migrate)
#   --test-db         run the RLS suite against it (pnpm test:db; implies --migrate)
#   --report          post the result to the app (POST /api/ops/restore-drill/report)
#   --out FILE        write the result (JSON) to FILE too
#   --keep            leave the throwaway container running (prints how to reach it)
# Test mode
#   --self-test       builds a fake backup from the repo's migrations with a fresh
#                     key, drills it, then checks that a wrong key and shrunken
#                     tables fail. Talks to no app and no storage. Needs pnpm.
#
# Checks (each ends up in the report): restore (pg_restore --exit-on-error),
# migrations (the backup's applied migrations are the repo's, in order),
# rls (every public table has RLS on, and policies if os_app may touch it),
# rows (DRILL_REQUIRE_ROWS non-empty; no table and no total below
# DRILL_MIN_RATIO of the last good drill), then migrate / test-db if asked.
#
# DRILL_QUIET=1 logs only each check's name and result; the details (row
# counts, error text) go to the report alone.
#
# Exit 0 when the drill passed, 1 when it failed (reported if --report),
# 2 on bad usage. Nothing here can reach the production database: the only
# Postgres it talks to is the container it started.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PG_IMAGE="${DRILL_PG_IMAGE:-postgres:17-alpine}"
REQUIRE_ROWS="${DRILL_REQUIRE_ROWS:-auth.user}"
MIN_RATIO="${DRILL_MIN_RATIO:-0.5}"
MIN_ROWS_FOR_RATIO="${DRILL_MIN_ROWS_FOR_RATIO:-20}"
SOURCE_PATH=/api/ops/restore-drill/source
REPORT_PATH=/api/ops/restore-drill/report

log() { printf '[drill %s] %s\n' "$(date -u +%H:%M:%S)" "$*" >&2; }
die() { log "ERROR: $*"; exit 2; }

usage() {
  awk 'NR > 1 && /^#/ { sub(/^# ?/, ""); print; next } NR > 1 { exit }' "${BASH_SOURCE[0]}"
  exit 2
}

# --- state ------------------------------------------------------------------------

FROM_APP=0 FILE="" IDENTITY="${AGE_IDENTITY_FILE:-}" PREVIOUS="" MIGRATE=0 TEST_DB=0 REPORT=0 OUT="" KEEP=0 SELF_TEST=0
WORK="" CONTAINER="" PGPASS="" APPPASS="" PORT=""
STEP="starting" STARTED_AT="" STARTED_S=0
CHECKS="[]" TABLES="{}" TOTAL_ROWS="null" ERROR=""
BACKUP_FILE="" BACKUP_AT="null" BACKUP_BYTES="null" PREVIOUS_JSON="null"
FINISHED=0

# add_check <name> <ok:true|false> <detail>
add_check() {
  CHECKS="$(jq -c --arg n "$1" --argjson ok "$2" --arg d "${3:0:500}" '. + [{name: $n, ok: $ok, detail: $d}]' <<<"$CHECKS")"
  # DRILL_QUIET=1 (the workflow: a public repo's logs are public) keeps the
  # details (row counts, error text that may quote data) in the report only.
  local detail=": $3"
  [[ "${DRILL_QUIET:-0}" == 1 ]] && detail=" (details in Ops → Server)"
  if [[ "$2" == true ]]; then log "ok    $1$detail"; else log "FAIL  $1$detail"; fi
}

failed() { [[ "$(jq '[.[] | select(.ok | not)] | length' <<<"$CHECKS")" != 0 || -n "$ERROR" ]]; }

# shellcheck disable=SC2317 # called by the EXIT trap
cleanup() {
  local rc=$?
  if [[ "$FINISHED" != 1 && "$SELF_TEST" != 1 ]]; then
    # Died halfway (set -e): still say so, and report it.
    ERROR="failed while $STEP (exit $rc)"
    finish || true
  fi
  if [[ -n "$CONTAINER" ]]; then
    if [[ "$KEEP" == 1 ]]; then
      log "kept $CONTAINER: postgres://postgres:$PGPASS@127.0.0.1:$PORT/anwar_os (docker rm -f $CONTAINER when done)"
    else
      docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    fi
  fi
  [[ -n "$WORK" ]] && rm -rf -- "$WORK"
  exit "$rc"
}

# --- talking to the app (HMAC like src/lib/signed-request.ts, x-drill-* headers) ---------

# signed_post <path> <body file> <out file>: prints the HTTP status.
signed_post() {
  local path="$1" body="$2" out="$3" ts nonce sig
  : "${DRILL_APP_URL:?set DRILL_APP_URL (e.g. https://anwar-os.com)}" "${RESTORE_DRILL_SECRET:?set RESTORE_DRILL_SECRET}"
  ts="$(date +%s)"
  nonce="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
  # The secret goes through the environment, never the command line.
  sig="$(SIGN_TS="$ts" SIGN_NONCE="$nonce" SIGN_PATH="$path" python3 -c '
import hashlib, hmac, os, sys
body = sys.stdin.buffer.read()
msg = "\n".join([os.environ["SIGN_TS"], os.environ["SIGN_NONCE"], "POST", os.environ["SIGN_PATH"]]).encode() + b"\n" + body
print(hmac.new(os.environ["RESTORE_DRILL_SECRET"].encode(), msg, hashlib.sha256).hexdigest())' <"$body")"
  curl -sS --max-time 60 -o "$out" -w '%{http_code}' -X POST \
    -H 'content-type: application/json' \
    -H "x-drill-timestamp: $ts" -H "x-drill-nonce: $nonce" -H "x-drill-signature: $sig" \
    --data-binary "@$body" "${DRILL_APP_URL%/}$path"
}

fetch_from_app() {
  STEP="asking the app for the newest backup"
  local status url
  printf '' >"$WORK/empty"
  status="$(signed_post "$SOURCE_PATH" "$WORK/empty" "$WORK/source.json")" || die "the app didn't answer ($DRILL_APP_URL)"
  if [[ "$status" != 200 ]]; then
    ERROR="the app refused the backup request (HTTP $status: $(jq -r '.message // .error // empty' "$WORK/source.json" 2>/dev/null | head -c 200))"
    return 1
  fi
  url="$(jq -r .url "$WORK/source.json")"
  [[ "${GITHUB_ACTIONS:-}" == true ]] && echo "::add-mask::$url"
  BACKUP_FILE="$(jq -r .file "$WORK/source.json")"
  BACKUP_AT="$(jq -c '.lastModified // null' "$WORK/source.json")"
  PREVIOUS_JSON="$(jq -c '.previous // null' "$WORK/source.json")"
  STEP="downloading the backup"
  log "downloading $BACKUP_FILE ($(jq -r .bytes "$WORK/source.json") bytes)"
  curl -fsS --max-time 900 --retry 2 -o "$WORK/backup.dump.age" "$url"
  FILE="$WORK/backup.dump.age"
}

# --- the throwaway Postgres --------------------------------------------------------------

psql_c() { docker exec -i "$CONTAINER" psql -U postgres -X -v ON_ERROR_STOP=1 -At "$@"; }

start_postgres() {
  STEP="starting a throwaway Postgres"
  CONTAINER="anwar-os-drill-$(python3 -c 'import secrets; print(secrets.token_hex(4))')"
  PGPASS="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
  APPPASS="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
  # Its own name, its own random port on 127.0.0.1, no volume: gone with `docker rm`.
  docker run -d --name "$CONTAINER" -e POSTGRES_PASSWORD="$PGPASS" -p 127.0.0.1::5432 \
    --label os.managed=false "$PG_IMAGE" >/dev/null
  local i
  for i in $(seq 1 60); do
    docker exec "$CONTAINER" pg_isready -U postgres -h 127.0.0.1 >/dev/null 2>&1 && break
    sleep 1
    [[ "$i" == 60 ]] && { ERROR="the throwaway Postgres didn't start"; return 1; }
  done
  PORT="$(docker port "$CONTAINER" 5432/tcp | head -n 1 | sed 's/.*://')"
  # Roles are cluster-level and not in pg_dump: the app's role (with a
  # password, for the RLS suite) and any old role a dump may still name.
  psql_c -d postgres -q -v app_password="$APPPASS" <<'SQL'
create role os_app login password :'app_password' nosuperuser nocreatedb nocreaterole nobypassrls;
create role bot_expenses nologin;
SQL
  log "throwaway Postgres $CONTAINER on 127.0.0.1:$PORT"
}

restore() {
  STEP="restoring"
  local rc=0 codes
  set +e
  age -d -i "$IDENTITY" "$FILE" 2>"$WORK/age.err" \
    | docker exec -i "$CONTAINER" pg_restore -U postgres -d postgres --create --exit-on-error 2>"$WORK/restore.err"
  codes=("${PIPESTATUS[@]}")
  set -e
  if [[ "${codes[0]}" != 0 ]]; then
    add_check restore false "age couldn't decrypt ${BACKUP_FILE:-$(basename "$FILE")}: $(tr '\n' ' ' <"$WORK/age.err" | head -c 300) (is the drill's key one of BACKUP_AGE_RECIPIENT?)"
    rc=1
  elif [[ "${codes[1]}" != 0 ]]; then
    add_check restore false "pg_restore failed: $(tail -n 3 "$WORK/restore.err" | tr '\n' ' ' | head -c 400)"
    rc=1
  else
    add_check restore true "${BACKUP_FILE:-$(basename "$FILE")} decrypted and restored into a throwaway Postgres in $(($(date +%s) - STARTED_S)) s"
  fi
  return "$rc"
}

# --- checks ---------------------------------------------------------------------------------

check_migrations() {
  STEP="checking migrations"
  local journal="$ROOT/db/migrations/meta/_journal.json" applied last expected repo_total newer differ=0 when hash tag file
  if ! applied="$(psql_c -d anwar_os -c 'select count(*) from drizzle.__drizzle_migrations' 2>/dev/null)"; then
    add_check migrations false "no drizzle.__drizzle_migrations table in the backup"
    return
  fi
  last="$(psql_c -d anwar_os -c 'select coalesce(max(created_at), 0) from drizzle.__drizzle_migrations')"
  repo_total="$(jq '.entries | length' "$journal")"
  expected="$(jq --argjson last "$last" '[.entries[] | select(.when <= $last)] | length' "$journal")"
  newer=$((repo_total - expected))
  # Same files as in the repo? (drizzle stores each file's sha256.)
  while IFS=$'\t' read -r when hash; do
    tag="$(jq -r --argjson w "$when" '.entries[] | select(.when == $w) | .tag' "$journal")"
    file="$ROOT/db/migrations/$tag.sql"
    if [[ -z "$tag" || ! -f "$file" ]] || [[ "$(sha256 "$file")" != "$hash" ]]; then differ=$((differ + 1)); fi
  done < <(psql_c -d anwar_os -F $'\t' -c 'select created_at, hash from drizzle.__drizzle_migrations order by created_at')
  local note=""
  ((differ > 0)) && note=" ($differ applied file(s) differ from the repo's copy)"
  if ((applied == 0)); then
    add_check migrations false "the backup has no migrations applied"
  elif ((applied != expected)); then
    add_check migrations false "the backup has $applied migrations, but the repo's journal has $expected up to its newest one$note"
  elif ((newer > 0)); then
    add_check migrations true "$applied of $repo_total applied; $newer newer than the backup (deployed after it)$note"
  else
    add_check migrations true "$applied of $repo_total applied$note"
  fi
}

sha256() {
  if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

check_rls() {
  STEP="checking row-level security"
  local bad count
  bad="$(psql_c -d anwar_os <<'SQL'
select n.nspname || '.' || c.relname || case when not c.relrowsecurity then ' (RLS off)' else ' (no policies)' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where c.relkind in ('r', 'p') and n.nspname = 'public'
   and (not c.relrowsecurity
        or (has_table_privilege('os_app', c.oid, 'select, insert, update, delete')
            and not exists (select 1 from pg_policy p where p.polrelid = c.oid)))
 order by 1;
SQL
)"
  count="$(psql_c -d anwar_os -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where c.relkind in ('r','p') and n.nspname = 'public' and c.relrowsecurity")"
  if [[ -n "$bad" ]]; then
    add_check rls false "$(tr '\n' ',' <<<"$bad" | sed 's/,$//; s/,/, /g')"
  else
    add_check rls true "all $count public tables have RLS on, with policies where os_app has access"
  fi
}

check_rows() {
  STEP="counting rows"
  TABLES="$(psql_c -d anwar_os <<'SQL'
select coalesce(json_object_agg(t, n order by t), '{}')
  from (
    select n.nspname || '.' || c.relname as t,
           (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint as n
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname in ('public', 'auth')
  ) s;
SQL
)"
  TABLES="$(jq -c . <<<"$TABLES")"
  TOTAL_ROWS="$(jq '[.[]] | add // 0' <<<"$TABLES")"
  local empty problems
  empty="$(jq -r --arg req "$REQUIRE_ROWS" '. as $t | [$req | split(" ")[] | select(. != "") | select(($t[.] // 0) == 0)] | join(", ")' <<<"$TABLES")"
  problems="$(jq -r --argjson prev "$PREVIOUS_JSON" --argjson ratio "$MIN_RATIO" --argjson min "$MIN_ROWS_FOR_RATIO" --argjson total "$TOTAL_ROWS" '
    . as $now
    | if $prev == null then [] else
        [ ($prev.tables // {}) | to_entries[]
          | select(.value >= $min and (($now[.key] // 0) < .value * $ratio))
          | "\(.key) \(.value) → \($now[.key] // "missing")" ]
        + (if ($prev.totalRows // 0) >= $min and $total < ($prev.totalRows * $ratio)
           then ["total \($prev.totalRows) → \($total)"] else [] end)
      end
    | join(", ")' <<<"$TABLES")"
  local tables
  tables="$(jq 'length' <<<"$TABLES")"
  if [[ -n "$empty" ]]; then
    add_check rows false "empty: $empty ($TOTAL_ROWS rows in $tables tables)"
  elif [[ -n "$problems" ]]; then
    add_check rows false "shrank below ${MIN_RATIO} of the last good drill: $problems"
  elif [[ "$PREVIOUS_JSON" == null ]]; then
    add_check rows true "$TOTAL_ROWS rows in $tables tables (no earlier drill to compare with)"
  else
    add_check rows true "$TOTAL_ROWS rows in $tables tables, within tolerance of the last good drill ($(jq -r '.totalRows // "?"' <<<"$PREVIOUS_JSON"))"
  fi
}

run_migrate() {
  STEP="applying the repo's migrations"
  if (cd "$ROOT" && MIGRATION_DATABASE_URL="postgres://postgres:$PGPASS@127.0.0.1:$PORT/anwar_os" \
    node ./node_modules/drizzle-kit/bin.cjs migrate >"$WORK/migrate.log" 2>&1); then
    add_check migrate true "the repo's migrations apply cleanly on top of the backup"
  else
    add_check migrate false "pnpm db:migrate failed: $(grep -iE 'error|fail' "$WORK/migrate.log" | head -n 3 | tr '\n' ' ' | head -c 400)"
    return 1
  fi
}

run_test_db() {
  STEP="running the RLS suite"
  local summary
  if (cd "$ROOT" && DATABASE_URL="postgres://os_app:$APPPASS@127.0.0.1:$PORT/anwar_os" \
    MIGRATION_DATABASE_URL="postgres://postgres:$PGPASS@127.0.0.1:$PORT/anwar_os" \
    node ./node_modules/vitest/vitest.mjs run --config vitest.db.config.mts --testTimeout=30000 >"$WORK/test-db.log" 2>&1); then
    summary="$(grep -E '^\s+Tests\s' "$WORK/test-db.log" | tail -n 1 | sed 's/^ *//')"
    add_check test-db true "pnpm test:db passed against the restored copy (${summary:-ok})"
  else
    summary="$(grep -E '^\s+(Tests|Test Files)\s|FAIL ' "$WORK/test-db.log" | head -n 4 | tr '\n' ' ' | head -c 400)"
    add_check test-db false "pnpm test:db failed: $summary"
  fi
}

# --- the report -------------------------------------------------------------------------------

finish() {
  FINISHED=1
  local status=ok finished_at duration report
  failed && status=failed
  finished_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  duration=$((($(date +%s) - STARTED_S) * 1000))
  local run_url=null commit=null bytes="$BACKUP_BYTES"
  if [[ -n "${GITHUB_RUN_ID:-}" ]]; then
    run_url="$(jq -n --arg u "${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" '$u')"
  fi
  [[ "${GITHUB_SHA:-}" =~ ^[0-9a-f]{7,40}$ ]] && commit="\"$GITHUB_SHA\""
  if [[ "$bytes" == null && -n "$FILE" && -f "$FILE" ]]; then bytes="$(wc -c <"$FILE" | tr -d ' ')"; fi
  report="$(jq -n \
    --arg status "$status" --arg started "$STARTED_AT" --arg finished "$finished_at" --argjson duration "$duration" \
    --arg file "$BACKUP_FILE" --argjson at "$BACKUP_AT" --argjson bytes "$bytes" \
    --argjson total "$TOTAL_ROWS" --argjson tables "$TABLES" --argjson checks "$CHECKS" \
    --arg error "$ERROR" --argjson runUrl "$run_url" --argjson commit "$commit" '
    {status: $status, startedAt: $started, finishedAt: $finished, durationMs: $duration,
     backup: {file: $file, at: $at, bytes: $bytes}, totalRows: $total, tables: $tables, checks: $checks,
     error: (if $error == "" then null else $error[0:2000] end), runUrl: $runUrl, commit: $commit}')"
  printf '%s\n' "$report" >"${WORK:-/tmp}/report.json"
  [[ -n "$OUT" ]] && printf '%s\n' "$report" >"$OUT"
  log "drill $status in $((duration / 1000)) s: $(jq -r '[.checks[] | "\(.name) \(if .ok then "ok" else "FAILED" end)"] | join(", ")' <<<"$report")${ERROR:+ · $ERROR}"
  if [[ "$REPORT" == 1 ]]; then
    local http
    if http="$(signed_post "$REPORT_PATH" "$WORK/report.json" "$WORK/report-answer.json")" && [[ "$http" == 200 ]]; then
      log "reported to ${DRILL_APP_URL%/}"
    else
      log "could not report the drill (HTTP ${http:-none}): $(head -c 300 "$WORK/report-answer.json" 2>/dev/null)"
      return 1
    fi
  fi
  [[ "$status" == ok ]]
}

# --- test mode ------------------------------------------------------------------------------

self_test() {
  # dir and src stay global: the EXIT trap removes them after this function returns.
  local srcpass pub rc=0
  command -v pnpm >/dev/null || die "--self-test needs pnpm (it builds a fake backup with the repo's migrations)"
  dir="$(mktemp -d)"
  WORK="$dir"
  src="anwar-os-drill-src-$(python3 -c 'import secrets; print(secrets.token_hex(4))')"
  srcpass="$(python3 -c 'import secrets; print(secrets.token_hex(16))')"
  trap 'docker rm -f "${src:-}" >/dev/null 2>&1 || true; rm -rf -- "${dir:-/nonexistent}"' EXIT

  log "self-test: a fake production database (repo migrations + an owner + notes)"
  docker run -d --name "$src" -e POSTGRES_PASSWORD="$srcpass" -e POSTGRES_DB=anwar_os -e OS_APP_PASSWORD="$srcpass" \
    -v "$ROOT/db/init:/docker-entrypoint-initdb.d:ro" -p 127.0.0.1::5432 "$PG_IMAGE" >/dev/null
  local i port
  for i in $(seq 1 60); do
    docker exec "$src" pg_isready -U postgres -d anwar_os -h 127.0.0.1 >/dev/null 2>&1 && break
    sleep 1
  done
  sleep 1
  port="$(docker port "$src" 5432/tcp | head -n 1 | sed 's/.*://')"
  (cd "$ROOT" && MIGRATION_DATABASE_URL="postgres://postgres:$srcpass@127.0.0.1:$port/anwar_os" \
    node ./node_modules/drizzle-kit/bin.cjs migrate >"$dir/src-migrate.log" 2>&1) || { cat "$dir/src-migrate.log" >&2; die "self-test: migrations failed"; }
  docker exec -i "$src" psql -U postgres -d anwar_os -X -q -v ON_ERROR_STOP=1 <<'SQL'
insert into auth."user" (id, name, email, email_verified, role) values ('drill-owner', 'Owner', 'owner@drill.test', true, 'owner');
insert into notes_notes (owner_id, title) select 'drill-owner', 'note ' || g from generate_series(1, 30) g;
SQL
  age-keygen -o "$dir/key.txt" 2>/dev/null
  pub="$(age-keygen -y "$dir/key.txt")"
  age-keygen -o "$dir/wrong.txt" 2>/dev/null
  docker exec "$src" pg_dump -U postgres -d anwar_os --format=custom --compress=6 | age -r "$pub" -o "$dir/anwar_os-selftest.dump.age"
  docker rm -f "$src" >/dev/null

  expect() { # expect <ok|failed> <check that must fail or ""> -- args...
    local want="$1" check="$2"
    shift 3
    local got
    "${BASH_SOURCE[0]}" "$@" --out "$dir/r.json" >/dev/null 2>"$dir/run.log" || true
    got="$(jq -r .status "$dir/r.json" 2>/dev/null || echo none)"
    if [[ "$got" != "$want" ]] || { [[ -n "$check" ]] && [[ "$(jq -r --arg c "$check" '.checks[] | select(.name == $c) | .ok' "$dir/r.json")" != false ]]; }; then
      log "self-test FAILED: expected $want${check:+ ($check failing)}, got $got"
      cat "$dir/run.log" >&2
      rc=1
    else
      log "self-test ok: $want${check:+ ($check failing)}"
    fi
  }

  expect ok "" -- --file "$dir/anwar_os-selftest.dump.age" -i "$dir/key.txt" --migrate
  jq '{tables, totalRows}' "$dir/r.json" >"$dir/prev.json"
  [[ "$(jq '.tables["public.notes_notes"]' "$dir/prev.json")" == 30 ]] || { log "self-test FAILED: row counts"; rc=1; }
  expect failed restore -- --file "$dir/anwar_os-selftest.dump.age" -i "$dir/wrong.txt"
  jq '.tables["public.notes_notes"] = 100 | .totalRows += 70' "$dir/prev.json" >"$dir/bigger.json"
  expect failed rows -- --file "$dir/anwar_os-selftest.dump.age" -i "$dir/key.txt" --previous "$dir/bigger.json"
  expect ok "" -- --file "$dir/anwar_os-selftest.dump.age" -i "$dir/key.txt" --previous "$dir/prev.json"
  if ((rc == 0)); then log "self-test passed"; else log "self-test failed"; fi
  return "$rc"
}

# --- main -----------------------------------------------------------------------------------

main() {
  while (($#)); do
    case "$1" in
      --from-app) FROM_APP=1; shift ;;
      --file) FILE="${2:?}"; shift 2 ;;
      -i | --identity) IDENTITY="${2:?}"; shift 2 ;;
      --previous) PREVIOUS="${2:?}"; shift 2 ;;
      --migrate) MIGRATE=1; shift ;;
      --test-db) TEST_DB=1; MIGRATE=1; shift ;;
      --report) REPORT=1; shift ;;
      --out) OUT="${2:?}"; shift 2 ;;
      --keep) KEEP=1; shift ;;
      --self-test) SELF_TEST=1; shift ;;
      -h | --help) usage ;;
      *) die "unknown option $1 (--help)" ;;
    esac
  done
  local tool
  for tool in docker age jq curl python3; do command -v "$tool" >/dev/null || die "needs $tool"; done
  if [[ "$SELF_TEST" == 1 ]]; then
    command -v age-keygen >/dev/null || die "needs age-keygen"
    self_test
    exit $?
  fi
  [[ "$FROM_APP" == 1 || -n "$FILE" ]] || die "say where the backup is: --from-app or --file (--help)"
  [[ "$FROM_APP" == 1 && -n "$FILE" ]] && die "--from-app or --file, not both"

  umask 077
  WORK="$(mktemp -d)"
  trap cleanup EXIT
  STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  STARTED_S="$(date +%s)"

  # The key: a file, or the GitHub secret's contents (written to the private work dir).
  if [[ -z "$IDENTITY" && -n "${DRILL_AGE_IDENTITY:-}" ]]; then
    printf '%s\n' "$DRILL_AGE_IDENTITY" >"$WORK/identity"
    IDENTITY="$WORK/identity"
    unset DRILL_AGE_IDENTITY
  fi
  [[ -r "$IDENTITY" ]] || die "no age identity: pass -i FILE or set DRILL_AGE_IDENTITY"

  if [[ -n "$PREVIOUS" ]]; then PREVIOUS_JSON="$(jq -c '{tables: (.tables // {}), totalRows: (.totalRows // null)}' "$PREVIOUS")"; fi
  if [[ "$FROM_APP" == 1 ]]; then
    fetch_from_app || { finish; exit 1; }
  else
    [[ -r "$FILE" ]] || die "can't read $FILE"
    BACKUP_FILE="$(basename "$FILE")"
  fi

  start_postgres || { finish; exit 1; }
  if restore; then
    check_migrations
    check_rls
    check_rows
    if [[ "$MIGRATE" == 1 ]] && run_migrate && [[ "$TEST_DB" == 1 ]]; then run_test_db; fi
  fi
  STEP="reporting"
  if finish; then exit 0; else exit 1; fi
}

main "$@"
