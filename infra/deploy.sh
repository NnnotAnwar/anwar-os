#!/usr/bin/env bash
# Deploy, roll back or inspect the anwar.os stack on the server.
#
#   deploy.sh <git-sha>   check out that commit of main, pull its images, migrate,
#                         replace web, wait for its healthcheck; then the bots (if
#                         the `bots` profile is on). On failure the previous
#                         commit + images are restored automatically.
#   deploy.sh rollback    redeploy the previous successful sha (from history)
#   deploy.sh status      current sha, container states, last deploys
#
# Runs as the `deploy` user from the repo checkout (/opt/anwar-os/repo by default).
# Images are tagged with the full commit sha by .github/workflows/deploy.yml.
#
# Note on rollbacks: migrations are not reversed. Write them expand/contract style
# (add columns/tables first, drop in a later release) so the previous web image
# keeps working against the newer schema.
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$INFRA_DIR/.." && pwd)"
ENV_FILE="$INFRA_DIR/.env"
HISTORY_FILE="$INFRA_DIR/.deploy-history"
LOCK_FILE="$INFRA_DIR/.deploy.lock"
BRANCH="${DEPLOY_BRANCH:-main}"
WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-180}"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

compose() { docker compose -f "$INFRA_DIR/compose.prod.yml" --env-file "$ENV_FILE" "$@"; }

# Value of KEY in .env (last occurrence), empty if unset.
env_get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

env_set() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s/^${key}=.*/${key}=${value}/" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

# True when the `bots` profile is active (COMPOSE_PROFILES=bots in .env).
bots_enabled() { compose config --services | grep -qx bot-expenses; }

resolve_sha() {
  # Accept a short or full sha; it must be a commit on origin/$BRANCH, so a stolen
  # CI key can't deploy arbitrary (e.g. fork PR) commits.
  local ref="$1" sha
  [[ "$ref" =~ ^[0-9a-f]{7,40}$ ]] || die "not a commit sha: $ref"
  git -C "$REPO_DIR" fetch --quiet origin "$BRANCH"
  sha="$(git -C "$REPO_DIR" rev-parse --verify --quiet "${ref}^{commit}")" \
    || die "unknown commit: $ref"
  git -C "$REPO_DIR" merge-base --is-ancestor "$sha" "origin/$BRANCH" \
    || die "$sha is not on origin/$BRANCH"
  printf '%s\n' "$sha"
}

checkout() {
  # .env, history and lock are gitignored and survive the checkout. A dirty
  # tracked file (hand edit on the server) makes this fail loudly.
  git -C "$REPO_DIR" checkout --quiet --detach "$1"
}

reload_caddy() {
  compose up -d --wait --wait-timeout 60 caddy
  compose exec -T caddy caddy reload --config /etc/caddy/Caddyfile >/dev/null
}

start_web() { compose up -d --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" web; }

start_bot() {
  # Image HEALTHCHECK: healthy once the bot has written its heartbeat.
  compose up -d --no-deps --wait --wait-timeout 240 bot-expenses
}

bootstrap_bot_db() {
  # Role + schema for the bot (idempotent; also syncs the password from .env).
  local pw
  pw="$(env_get BOT_EXPENSES_DB_PASSWORD)"
  [[ -n "$pw" ]] || die "BOT_EXPENSES_DB_PASSWORD is empty but the bots profile is on"
  compose exec -T db psql -U postgres -d anwar_os -X -q -v ON_ERROR_STOP=1 \
    -v bot_password="$pw" -f - <"$REPO_DIR/bots/expenses/db/bootstrap.sql" >/dev/null
}

deploy() {
  local sha prev_tag prev_bot_tag prev_sha bots=0
  sha="$(resolve_sha "$1")"
  prev_tag="$(env_get WEB_TAG)"
  prev_bot_tag="$(env_get BOT_EXPENSES_TAG)"
  prev_sha="$(git -C "$REPO_DIR" rev-parse HEAD)"

  log "deploying $sha (was ${prev_tag:-unset})"
  checkout "$sha"
  env_set WEB_TAG "$sha"
  local -a images=(web migrate)
  if bots_enabled; then
    bots=1
    env_set BOT_EXPENSES_TAG "$sha"
    images+=(bot-expenses)
  fi

  restore_previous() {
    log "restoring previous release ${prev_tag:-unset}"
    git -C "$REPO_DIR" checkout --quiet --detach "$prev_sha" || true
    env_set WEB_TAG "${prev_tag:-latest}"
    ((bots)) && env_set BOT_EXPENSES_TAG "${prev_bot_tag:-latest}"
    return 0
  }

  if ! compose pull --quiet "${images[@]}"; then
    restore_previous
    die "image pull failed (did CI finish pushing $sha? is the server logged in to ghcr.io?)"
  fi

  compose up -d --wait --wait-timeout 120 db

  log "running migrations"
  if ! compose run --rm -T migrate; then
    restore_previous
    die "migrations failed; web was not touched"
  fi

  log "starting web and waiting for its healthcheck"
  if ! start_web; then
    compose logs --tail 80 web >&2 || true
    restore_previous
    log "bringing the previous web image back"
    start_web || log "previous image is unhealthy too: check 'docker compose logs web'"
    die "new web container failed its healthcheck; rolled back"
  fi

  reload_caddy
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha" >>"$HISTORY_FILE"
  log "web is live at $sha"

  if ((bots)); then
    log "bot-expenses: bootstrap role/schema, start, wait for heartbeat"
    if ! { bootstrap_bot_db && start_bot; }; then
      compose logs --tail 80 bot-expenses >&2 || true
      env_set BOT_EXPENSES_TAG "${prev_bot_tag:-latest}"
      start_bot || log "previous bot image is unhealthy too"
      die "bot-expenses failed to start; bot rolled back to ${prev_bot_tag:-latest} (web stays at $sha)"
    fi
  fi

  # Keep ~10 days of old images for rollbacks, drop the rest.
  docker image prune -af --filter "until=240h" >/dev/null || true
  log "done: $sha is live"
}

rollback() {
  local current prev
  current="$(env_get WEB_TAG)"
  [[ -f "$HISTORY_FILE" ]] || die "no deploy history yet"
  prev="$(awk -v cur="$current" '$2 != cur { sha = $2 } END { print sha }' "$HISTORY_FILE")"
  [[ -n "$prev" ]] || die "no earlier release than $current in $HISTORY_FILE"
  log "rolling back $current -> $prev"
  deploy "$prev"
}

status() {
  printf 'commit:           %s\n' "$(git -C "$REPO_DIR" log -1 --format='%H %s' 2>/dev/null || echo '?')"
  printf 'WEB_TAG:          %s\n' "$(env_get WEB_TAG)"
  printf 'BOT_EXPENSES_TAG: %s\n\n' "$(env_get BOT_EXPENSES_TAG)"
  compose ps
  if [[ -f "$HISTORY_FILE" ]]; then
    printf '\nlast deploys:\n'
    tail -n 5 "$HISTORY_FILE"
  fi
}

main() {
  [[ -f "$ENV_FILE" ]] || die "missing $ENV_FILE (copy .env.example and fill it in)"
  case "${1:-}" in
    status) status ;;
    rollback | [0-9a-f]*)
      exec 9>"$LOCK_FILE"
      flock -n 9 || die "another deploy is running"
      if [[ "$1" == rollback ]]; then rollback; else deploy "$1"; fi
      ;;
    *)
      sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 2
      ;;
  esac
}

main "$@"
