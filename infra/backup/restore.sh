#!/usr/bin/env bash
# Restore an encrypted backup made by backup.sh into the stack's Postgres.
#
#   sudo infra/backup/restore.sh -i KEY_FILE [--into-live] [--keep] [-y] SOURCE
#
# SOURCE    latest                 newest file in daily/ on the remote
#           daily/<file>.dump.age  any file on the remote (also weekly/, monthly/)
#           /path/to/file.dump.age a local file
# -i FILE   age identity (the PRIVATE key). Not stored on the server: copy it in
#           for the restore, then delete it (shred -u). Also $AGE_IDENTITY_FILE.
#
# Default mode is a DRILL: restore into a scratch database `anwar_os_restore`,
# print what came back, drop it (unless --keep). Production is untouched.
#
# --into-live replaces the live `anwar_os` database: stops web, saves an
# encrypted safety dump of the current database to BACKUP_LOCAL_DIR, drops the
# database, recreates it from the backup (including database-level grants), and
# starts web again. Roles are cluster-level and not in the dump: os_app comes
# from db/init/01-roles.sh, missing ones are created NOLOGIN, and bot_expenses
# gets its password back from bots/expenses/db/bootstrap.sql. The bot (if its
# profile is on) is stopped and started together with web.
set -euo pipefail

# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SCRATCH_DB=anwar_os_restore

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 2
}

confirm() {
  [[ "$ASSUME_YES" == 1 ]] && return 0
  local answer
  read -r -p "$1 Type 'yes' to continue: " answer
  [[ "$answer" == yes ]] || die "aborted"
}

psql_db() { compose exec -T db psql -U postgres -v ON_ERROR_STOP=1 -X "$@"; }

fetch() {
  # Resolve SOURCE to a local file path in $FILE.
  local src="$1" rel
  if [[ -f "$src" ]]; then
    FILE="$src"
    return
  fi
  configure_remote
  [[ -n "$REMOTE" ]] || die "BACKUP_TARGET=none: pass a local file"
  if [[ "$src" == latest ]]; then
    rel="daily/$(list_remote daily | tail -n 1)"
    [[ "$rel" != "daily/" ]] || die "no backups in $REMOTE/daily"
  else
    rel="$src"
  fi
  WORK_DIR="$(mktemp -d)"
  FILE="$WORK_DIR/${rel##*/}"
  log "downloading $REMOTE/$rel"
  rclone copyto "$REMOTE/$rel" "$FILE"
}

decrypt() { age -d -i "$IDENTITY" "$FILE"; }

ensure_roles() {
  # Roles are cluster-level and not in pg_dump. On a fresh server os_app comes
  # from db/init; create any role the dump references that is still missing
  # (as NOLOGIN) so ownership and grants restore cleanly.
  psql_db -d postgres -q <<'SQL'
select format('create role %I nologin', r)
from unnest(array['os_app', 'bot_expenses']) as r
where not exists (select 1 from pg_roles where rolname = r)
\gexec
SQL
}

bootstrap_bot() {
  # Gives bot_expenses its LOGIN + password from .env again (idempotent).
  local sql="$INFRA_DIR/../bots/expenses/db/bootstrap.sql"
  [[ -n "${BOT_EXPENSES_DB_PASSWORD:-}" && -f "$sql" ]] || return 0
  log "re-applying bots/expenses/db/bootstrap.sql"
  psql_db -d "$DB_NAME" -q -v bot_password="$BOT_EXPENSES_DB_PASSWORD" -f - <"$sql" >/dev/null
}

restore_drill() {
  ensure_roles
  log "restoring into scratch database $SCRATCH_DB"
  compose exec -T db dropdb -U postgres --if-exists --force "$SCRATCH_DB"
  compose exec -T db createdb -U postgres "$SCRATCH_DB"
  decrypt | compose exec -T db pg_restore -U postgres -d "$SCRATCH_DB" --exit-on-error

  log "restored contents:"
  psql_db -d "$SCRATCH_DB" -c "analyze" >/dev/null
  psql_db -d "$SCRATCH_DB" -c "
    select schemaname as schema, relname as table, n_live_tup as rows
    from pg_stat_user_tables order by schemaname, relname;"

  if [[ "$KEEP" == 1 ]]; then
    log "kept $SCRATCH_DB (drop it with: docker compose exec db dropdb -U postgres $SCRATCH_DB)"
  else
    compose exec -T db dropdb -U postgres --force "$SCRATCH_DB"
  fi
  log "drill OK: $(basename "$FILE") decrypts and restores cleanly"
}

restore_live() {
  confirm "This REPLACES the live database '$DB_NAME' with $(basename "$FILE")."
  : "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT for the safety dump}"
  local -a keys recipients=()
  local key safety magic
  read -r -a keys <<<"$BACKUP_AGE_RECIPIENT"
  for key in "${keys[@]}"; do recipients+=(-r "$key"); done

  # Check the backup decrypts to a pg_dump archive before touching anything.
  # (head closes the pipe early, so age's SIGPIPE status is ignored here.)
  magic="$(decrypt | head -c 5 || true)"
  [[ "$magic" == PGDMP ]] || die "not a decryptable pg_dump archive (wrong key?)"

  local -a apps=(web)
  compose config --services | grep -qx bot-expenses && apps+=(bot-expenses)
  log "stopping ${apps[*]}"
  compose stop "${apps[@]}"

  safety="${BACKUP_LOCAL_DIR:-/var/backups/anwar-os}/pre-restore-$(date -u +%Y-%m-%dT%H%M%SZ)${FILE_SUFFIX}"
  log "safety dump of the current database -> $safety"
  install -d -m 700 "$(dirname "$safety")"
  compose exec -T db pg_dump -U postgres -d "$DB_NAME" --format=custom \
    | age "${recipients[@]}" -o "$safety"

  log "recreating $DB_NAME from the backup"
  ensure_roles
  compose exec -T db dropdb -U postgres --if-exists --force "$DB_NAME"
  decrypt | compose exec -T db pg_restore -U postgres -d postgres --create --exit-on-error
  bootstrap_bot

  log "starting ${apps[*]}"
  compose up -d --no-deps --wait --wait-timeout 240 "${apps[@]}"
  log "live restore OK. If something is off, restore the safety dump the same way."
}

main() {
  IDENTITY="${AGE_IDENTITY_FILE:-}"
  INTO_LIVE=0 KEEP=0 ASSUME_YES=0
  local src=""
  while (($#)); do
    case "$1" in
      -i | --identity) IDENTITY="${2:?}"; shift 2 ;;
      --into-live) INTO_LIVE=1; shift ;;
      --keep) KEEP=1; shift ;;
      -y | --yes) ASSUME_YES=1; shift ;;
      -h | --help) usage ;;
      -*) die "unknown option $1" ;;
      *) src="$1"; shift ;;
    esac
  done
  [[ -n "$src" ]] || usage
  [[ -r "$IDENTITY" ]] || die "age identity file not readable: ${IDENTITY:-<none>} (use -i)"

  load_env
  WORK_DIR=""
  trap '[[ -n "$WORK_DIR" ]] && rm -rf -- "$WORK_DIR"' EXIT
  umask 077

  fetch "$src"
  if [[ "$INTO_LIVE" == 1 ]]; then restore_live; else restore_drill; fi
}

main "$@"
