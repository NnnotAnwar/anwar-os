#!/usr/bin/env bash
# Deploy, roll back or inspect the anwar.os stack on the server.
#
#   deploy.sh <git-sha>   check out that commit of main, pull its images, migrate,
#                         replace web, wait for its healthcheck; then ops-agent
#                         and the bots (if the `ops` / `bots` profiles are on).
#                         On failure the previous commit + images are restored.
#   deploy.sh rollback    redeploy the previous successful sha (from history)
#   deploy.sh status      current sha, container states, last deploys
#
# Runs as the `deploy` user from the repo checkout (/opt/anwar-os/repo by default).
# Images are tagged with the full commit sha by .github/workflows/deploy.yml.
#
# The server can host several projects. Ports 80/443 belong to the shared edge
# Caddy (infra/edge, config in /opt/edge); this script only writes anwar.os's
# own site file there (/opt/edge/sites/anwar-os.caddy) and reloads it.
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
EDGE_DIR="${EDGE_DIR:-/opt/edge}"
SITE_NAME=anwar-os
BRANCH="${DEPLOY_BRANCH:-main}"
WAIT_TIMEOUT="${DEPLOY_WAIT_TIMEOUT:-180}"

log() { printf '[deploy %s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

compose() { docker compose -f "$INFRA_DIR/compose.prod.yml" --env-file "$ENV_FILE" "$@"; }

# The shared edge stack (one Caddy for every project on the server).
edge() { docker compose -f "$INFRA_DIR/edge/compose.yml" --env-file "$EDGE_DIR/.env" "$@"; }

# ops-agent joins the Docker socket's group; take it from the socket unless .env
# pins it. Process env wins over --env-file in compose.
if [[ -z "${DOCKER_GID:-}" && -S /var/run/docker.sock ]]; then
  DOCKER_GID="$(stat -c %g /var/run/docker.sock)"
  export DOCKER_GID
fi

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

# True when the `ops` profile is active (COMPOSE_PROFILES=...,ops in .env) and
# the agent has its secret.
ops_enabled() {
  compose config --services | grep -qx ops-agent && [[ -n "$(env_get OPS_AGENT_SECRET)" ]]
}

# Each bot is deployed only once it is configured, so the profile can be on
# with just one of them set up.
# The expense bot writes into Budget through web's signed API, so it needs the
# shared secret and the owner's Telegram id (OSBOT_OWNER_CHAT_ID as fallback).
expenses_configured() {
  [[ -n "$(env_get BOT_EXPENSES_TOKEN)" && -n "$(env_get BOT_EXPENSES_API_SECRET)" ]] &&
    [[ -n "$(env_get BOT_EXPENSES_OWNER_ID)" || -n "$(env_get OSBOT_OWNER_CHAT_ID)" ]]
}
osbot_configured() {
  [[ -n "$(env_get OSBOT_TOKEN)" && -n "$(env_get OSBOT_API_SECRET)" && -n "$(env_get OSBOT_OWNER_CHAT_ID)" ]]
}

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

ensure_edge_network() {
  docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null
}

# Render this project's site file into the shared edge and reload Caddy. A
# rejected config leaves the running one untouched; the previous file is put
# back so the next reload doesn't trip over it either.
publish_site() {
  local domain site prev
  domain="$(env_get DOMAIN)"
  [[ "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || die "DOMAIN in .env is not a hostname: '$domain'"
  [[ -f "$EDGE_DIR/.env" ]] || die "missing $EDGE_DIR/.env (copy infra/edge/.env.example, set ACME_EMAIL)"
  install -d "$EDGE_DIR/sites"
  site="$EDGE_DIR/sites/$SITE_NAME.caddy"
  prev="$site.prev"
  [[ -f "$site" ]] && cp "$site" "$prev"
  sed "s/__DOMAIN__/$domain/g" "$INFRA_DIR/edge/sites/$SITE_NAME.caddy.tmpl" >"$site.new"
  mv "$site.new" "$site"

  edge up -d --wait --wait-timeout 60 caddy
  if ! edge exec -T caddy caddy reload --config /etc/caddy/base/Caddyfile --adapter caddyfile >/dev/null; then
    if [[ -f "$prev" ]]; then mv "$prev" "$site"; else rm -f "$site"; fi
    die "the edge Caddy rejected the $SITE_NAME site config; kept the previous one"
  fi
  rm -f "$prev"
}

start_web() { compose up -d --no-deps --wait --wait-timeout "$WAIT_TIMEOUT" web; }

start_ops_agent() { compose up -d --no-deps --wait --wait-timeout 60 ops-agent; }

start_bot() {
  # Healthy once web accepted its first signed heartbeat (secret, internal
  # network and owner account all work).
  compose up -d --no-deps --wait --wait-timeout 240 bot-expenses
}

start_osbot() {
  # Healthy once web accepted its first signed heartbeat (so the shared secret,
  # the internal network and the owner account all work).
  compose up -d --no-deps --wait --wait-timeout 240 bot-osbot
}

deploy() {
  local sha prev_tag prev_bot_tag prev_osbot_tag prev_ops_tag prev_sha bots=0 osbot=0 ops=0
  sha="$(resolve_sha "$1")"
  prev_tag="$(env_get WEB_TAG)"
  prev_bot_tag="$(env_get BOT_EXPENSES_TAG)"
  prev_osbot_tag="$(env_get BOT_OSBOT_TAG)"
  prev_ops_tag="$(env_get OPS_AGENT_TAG)"
  prev_sha="$(git -C "$REPO_DIR" rev-parse HEAD)"

  log "deploying $sha (was ${prev_tag:-unset})"
  checkout "$sha"
  env_set WEB_TAG "$sha"
  local -a images=(web migrate)
  if bots_enabled; then
    if expenses_configured; then
      bots=1
      env_set BOT_EXPENSES_TAG "$sha"
      images+=(bot-expenses)
    else
      log "bots profile on, BOT_EXPENSES_TOKEN/BOT_EXPENSES_API_SECRET/owner id incomplete: skipping bot-expenses"
    fi
    if osbot_configured; then
      osbot=1
      env_set BOT_OSBOT_TAG "$sha"
      images+=(bot-osbot)
    else
      log "bots profile on, OSBOT_TOKEN/OSBOT_API_SECRET/OSBOT_OWNER_CHAT_ID incomplete: skipping bot-osbot"
    fi
  fi
  if ops_enabled; then
    ops=1
    env_set OPS_AGENT_TAG "$sha"
    images+=(ops-agent)
  fi

  restore_previous() {
    log "restoring previous release ${prev_tag:-unset}"
    git -C "$REPO_DIR" checkout --quiet --detach "$prev_sha" || true
    env_set WEB_TAG "${prev_tag:-latest}"
    ((bots)) && env_set BOT_EXPENSES_TAG "${prev_bot_tag:-latest}"
    ((osbot)) && env_set BOT_OSBOT_TAG "${prev_osbot_tag:-latest}"
    ((ops)) && env_set OPS_AGENT_TAG "${prev_ops_tag:-latest}"
    return 0
  }

  if ! compose pull --quiet "${images[@]}"; then
    restore_previous
    die "image pull failed (did CI finish pushing $sha? is the server logged in to ghcr.io?)"
  fi

  ensure_edge_network
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

  publish_site
  printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$sha" >>"$HISTORY_FILE"
  log "web is live at $sha"

  if ((ops)); then
    log "ops-agent: start and wait for its healthcheck"
    if ! start_ops_agent; then
      compose logs --tail 40 ops-agent >&2 || true
      env_set OPS_AGENT_TAG "${prev_ops_tag:-latest}"
      start_ops_agent || log "previous ops-agent image is unhealthy too"
      log "WARNING: ops-agent failed to start; kept ${prev_ops_tag:-latest} (web stays at $sha)"
    fi
  fi

  if ((bots)); then
    log "bot-expenses: start, wait for its first heartbeat"
    if ! start_bot; then
      compose logs --tail 80 bot-expenses >&2 || true
      env_set BOT_EXPENSES_TAG "${prev_bot_tag:-latest}"
      start_bot || log "previous bot image is unhealthy too"
      die "bot-expenses failed to start; bot rolled back to ${prev_bot_tag:-latest} (web stays at $sha)"
    fi
  fi

  if ((osbot)); then
    log "bot-osbot: start, wait for its first heartbeat"
    if ! start_osbot; then
      compose logs --tail 80 bot-osbot >&2 || true
      env_set BOT_OSBOT_TAG "${prev_osbot_tag:-latest}"
      start_osbot || log "previous osbot image is unhealthy too"
      die "bot-osbot failed to start; rolled back to ${prev_osbot_tag:-latest} (web stays at $sha)"
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
  printf 'BOT_EXPENSES_TAG: %s\n' "$(env_get BOT_EXPENSES_TAG)"
  printf 'BOT_OSBOT_TAG:    %s\n' "$(env_get BOT_OSBOT_TAG)"
  printf 'OPS_AGENT_TAG:    %s\n\n' "$(env_get OPS_AGENT_TAG)"
  compose ps
  printf '\nedge (shared):\n'
  edge ps 2>/dev/null || printf '  not running (or %s/.env missing)\n' "$EDGE_DIR"
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
