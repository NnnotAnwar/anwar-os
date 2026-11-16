#!/usr/bin/env bash
# Shared helpers for backup.sh and restore.sh. Sourced, not executed.
# shellcheck disable=SC2034 # variables here are used by the sourcing scripts

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ENV_FILE:-$INFRA_DIR/.env}"
COMPOSE_FILE="$INFRA_DIR/compose.prod.yml"
DB_NAME=anwar_os
FILE_PREFIX=anwar_os-
FILE_SUFFIX=.dump.age

log() { printf '[%s %s] %s\n' "${0##*/}" "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# Read KEY=value lines from the stack's .env without executing it. Variables that
# are already set in the environment win.
load_env() {
  local line key val
  [[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^[A-Za-z_][A-Za-z0-9_]*= ]] || continue
    key="${line%%=*}"
    val="${line#*=}"
    if [[ "$val" =~ ^\"(.*)\"$ || "$val" =~ ^\'(.*)\'$ ]]; then
      val="${BASH_REMATCH[1]}"
    fi
    [[ -n "${!key+set}" ]] || export "$key=$val"
  done <"$ENV_FILE"
}

compose() { docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"; }

# Configure an rclone remote named "offsite" purely through environment
# variables (no rclone.conf on disk) and set REMOTE to the backup root on it.
configure_remote() {
  local prefix="${BACKUP_PREFIX:-postgres}"
  # Everything is configured by env; skip the "rclone.conf not found" notice.
  export RCLONE_LOG_LEVEL="${RCLONE_LOG_LEVEL:-ERROR}"
  case "${BACKUP_TARGET:-s3}" in
    s3)
      # Same Object Storage settings as the app (S3_*); BACKUP_S3_* override
      # them, so backups can live in their own bucket with their own key.
      local endpoint="${BACKUP_S3_ENDPOINT:-${S3_ENDPOINT:-}}"
      local region="${BACKUP_S3_REGION:-${S3_REGION:-}}"
      local bucket="${BACKUP_S3_BUCKET:-${S3_BUCKET:-}}"
      local key_id="${BACKUP_S3_ACCESS_KEY_ID:-${S3_ACCESS_KEY_ID:-}}"
      local secret="${BACKUP_S3_SECRET_ACCESS_KEY:-${S3_SECRET_ACCESS_KEY:-}}"
      local path_style="${BACKUP_S3_FORCE_PATH_STYLE:-${S3_FORCE_PATH_STYLE:-false}}"
      [[ -n "$endpoint" && -n "$bucket" && -n "$key_id" && -n "$secret" ]] \
        || die "set S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and BACKUP_S3_BUCKET (or S3_BUCKET)"
      export RCLONE_CONFIG_OFFSITE_TYPE=s3
      export RCLONE_CONFIG_OFFSITE_PROVIDER=Other
      export RCLONE_CONFIG_OFFSITE_ENDPOINT="$endpoint"
      export RCLONE_CONFIG_OFFSITE_REGION="$region"
      export RCLONE_CONFIG_OFFSITE_ACCESS_KEY_ID="$key_id"
      export RCLONE_CONFIG_OFFSITE_SECRET_ACCESS_KEY="$secret"
      export RCLONE_CONFIG_OFFSITE_FORCE_PATH_STYLE="$path_style"
      export RCLONE_CONFIG_OFFSITE_ACL=private
      export RCLONE_CONFIG_OFFSITE_NO_CHECK_BUCKET=true
      REMOTE="offsite:${bucket}/${prefix}"
      ;;
    sftp)
      # Hetzner Storage Box: SSH on port 23, key-based login for a sub-account.
      : "${BACKUP_SFTP_HOST:?set BACKUP_SFTP_HOST}" "${BACKUP_SFTP_USER:?set BACKUP_SFTP_USER}"
      export RCLONE_CONFIG_OFFSITE_TYPE=sftp
      export RCLONE_CONFIG_OFFSITE_HOST="$BACKUP_SFTP_HOST"
      export RCLONE_CONFIG_OFFSITE_USER="$BACKUP_SFTP_USER"
      export RCLONE_CONFIG_OFFSITE_PORT="${BACKUP_SFTP_PORT:-23}"
      export RCLONE_CONFIG_OFFSITE_KEY_FILE="${BACKUP_SFTP_KEY_FILE:-/root/.ssh/storagebox}"
      export RCLONE_CONFIG_OFFSITE_SHELL_TYPE=none
      REMOTE="offsite:${prefix}"
      ;;
    none)
      REMOTE="" # local copies only (testing)
      ;;
    *) die "BACKUP_TARGET must be s3, sftp or none" ;;
  esac
}

# Names of backup files under $REMOTE/$1, oldest first.
list_remote() {
  rclone lsf --files-only "$REMOTE/$1/" 2>/dev/null \
    | grep -E "^${FILE_PREFIX}.*${FILE_SUFFIX//./\\.}\$" | sort || true
}
