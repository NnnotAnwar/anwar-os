#!/usr/bin/env bash
# Nightly Postgres backup: pg_dump (custom format) -> age -> off-site.
#
# Run by anwar-os-backup.timer as root; by hand: sudo infra/backup/backup.sh
# Configuration comes from infra/.env (see .env.example, "Backups").
#
# The plaintext dump never touches the disk: it streams from pg_dump inside the
# db container straight into age. Only the public key (recipient) lives on the
# server; the private key stays offline with the owner.
#
# Layout on the remote, newest kept per folder:
#   daily/   anwar_os-2026-11-16T021503Z.dump.age   BACKUP_KEEP_DAILY   (7)
#   weekly/  anwar_os-2026-W46.dump.age             BACKUP_KEEP_WEEKLY  (4)
#   monthly/ anwar_os-2026-11.dump.age              BACKUP_KEEP_MONTHLY (6)
# The first successful backup of an ISO week / month is promoted, so a failed
# night doesn't leave a gap in the weekly/monthly series.
set -euo pipefail

# shellcheck source=infra/backup/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

ping_status() {
  # Optional dead-man's switch (healthchecks.io style): URL on success, URL/fail
  # on failure.
  [[ -n "${BACKUP_PING_URL:-}" ]] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${BACKUP_PING_URL}$1" || true
}

on_exit() {
  local rc=$?
  [[ -n "${tmp:-}" ]] && rm -f -- "$tmp"
  if ((rc != 0)); then
    log "backup FAILED (exit $rc)"
    ping_status /fail
  fi
}

prune_remote() {
  local dir="$1" keep="$2" n i
  local -a files
  mapfile -t files < <(list_remote "$dir")
  n=${#files[@]}
  for ((i = 0; i < n - keep; i++)); do
    log "prune $dir/${files[i]}"
    rclone deletefile "$REMOTE/$dir/${files[i]}"
  done
}

prune_local() {
  local keep="$1" n i
  local -a files
  mapfile -t files < <(find "$LOCAL_DIR" -maxdepth 1 -type f -name "${FILE_PREFIX}*${FILE_SUFFIX}" -printf '%f\n' | sort)
  n=${#files[@]}
  for ((i = 0; i < n - keep; i++)); do
    rm -f -- "${LOCAL_DIR:?}/${files[i]}"
  done
}

main() {
  trap on_exit EXIT
  load_env
  configure_remote

  : "${BACKUP_AGE_RECIPIENT:?set BACKUP_AGE_RECIPIENT (age public key)}"
  LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/anwar-os}"
  local keep_daily="${BACKUP_KEEP_DAILY:-7}" keep_weekly="${BACKUP_KEEP_WEEKLY:-4}"
  local keep_monthly="${BACKUP_KEEP_MONTHLY:-6}" keep_local="${BACKUP_LOCAL_KEEP:-2}"

  umask 077
  install -d -m 700 "$LOCAL_DIR"

  # One or more recipients, space-separated (e.g. laptop key + offline paper key).
  local -a keys recipients=()
  local key
  read -r -a keys <<<"$BACKUP_AGE_RECIPIENT"
  for key in "${keys[@]}"; do recipients+=(-r "$key"); done

  local stamp name file week month
  stamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
  week="$(date -u +%G-W%V)"
  month="$(date -u +%Y-%m)"
  name="${FILE_PREFIX}${stamp}${FILE_SUFFIX}"
  file="$LOCAL_DIR/$name"
  tmp="$LOCAL_DIR/.${name}.partial"

  log "dumping $DB_NAME"
  compose exec -T db pg_dump -U postgres -d "$DB_NAME" --format=custom --compress=6 \
    | age "${recipients[@]}" -o "$tmp"
  # An empty database still dumps to a few KB; anything tiny means pg_dump died.
  (($(stat -c %s "$tmp") > 512)) || die "dump is suspiciously small"
  mv "$tmp" "$file"
  tmp=""
  log "wrote $file ($(du -h "$file" | cut -f1))"

  if [[ -n "$REMOTE" ]]; then
    log "uploading to $REMOTE"
    rclone copyto "$file" "$REMOTE/daily/$name"
    if ! list_remote weekly | grep -q "^${FILE_PREFIX}${week}"; then
      rclone copyto "$file" "$REMOTE/weekly/${FILE_PREFIX}${week}${FILE_SUFFIX}"
      log "promoted to weekly/$week"
    fi
    if ! list_remote monthly | grep -q "^${FILE_PREFIX}${month}"; then
      rclone copyto "$file" "$REMOTE/monthly/${FILE_PREFIX}${month}${FILE_SUFFIX}"
      log "promoted to monthly/$month"
    fi
    prune_remote daily "$keep_daily"
    prune_remote weekly "$keep_weekly"
    prune_remote monthly "$keep_monthly"
  fi

  prune_local "$keep_local"
  ping_status ""
  log "backup OK: $name"
}

main "$@"
