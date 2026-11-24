#!/usr/bin/env bash
# External uptime check, run by .github/workflows/uptime.yml every 10 minutes
# (the server can't report itself when it is down). Checks each target with
# retries, compares with the previous run's state and sends a Telegram message
# only when a target goes down or comes back.
#
#   UPTIME_TARGETS     one target per line: "<name>|<url>|<expected HTTP status>"
#                      (default: anwar-os.com health, shiftella.app, dev.shiftella.app)
#   STATE_FILE         previous state, rewritten in place (default .uptime-state/state)
#   TELEGRAM_TOKEN     bot token  } both empty = check and report in the job
#   TELEGRAM_CHAT_ID   chat id    } summary only, no messages
#   ATTEMPTS, RETRY_DELAY, TIMEOUT   3, 20 s, 15 s
#
# Writes changed=true|false to $GITHUB_OUTPUT (the workflow saves the state
# only when it changed). Always exits 0 when the checks ran: a red run every
# 10 minutes while a site is down would only add e-mail noise to Telegram.
set -euo pipefail

DEFAULT_TARGETS='anwar-os.com|https://anwar-os.com/api/health|200
shiftella.app|https://shiftella.app/|200
dev.shiftella.app|https://dev.shiftella.app/|401'

TARGETS="${UPTIME_TARGETS:-$DEFAULT_TARGETS}"
STATE_FILE="${STATE_FILE:-.uptime-state/state}"
ATTEMPTS="${ATTEMPTS:-3}"
RETRY_DELAY="${RETRY_DELAY:-20}"
TIMEOUT="${TIMEOUT:-15}"
NOW="$(date -u +%s)"

log() { printf '%s\n' "$*" >&2; }

# probe <url>: prints the HTTP status, or "000" when there was no answer.
probe() {
  curl --silent --output /dev/null --write-out '%{http_code}' --max-time "$TIMEOUT" \
    --proto '=https' --user-agent 'anwar-os-uptime (GitHub Actions)' "$1" 2>/dev/null || true
}

# check <url> <expected>: retries; prints the last status seen, returns 0 if it matched.
check() {
  local url="$1" expected="$2" status="" i
  for ((i = 1; i <= ATTEMPTS; i++)); do
    status="$(probe "$url")"
    [[ -z "$status" ]] && status=000
    [[ "$status" == "$expected" ]] && { printf '%s' "$status"; return 0; }
    log "  attempt $i/$ATTEMPTS: $url answered $status (want $expected)"
    ((i < ATTEMPTS)) && sleep "$RETRY_DELAY"
  done
  printf '%s' "$status"
  return 1
}

# duration <seconds>: "3 h 12 min", "8 min", "40 s".
duration() {
  local s="$1"
  if ((s >= 86400)); then printf '%d d %d h' $((s / 86400)) $((s % 86400 / 3600))
  elif ((s >= 3600)); then printf '%d h %d min' $((s / 3600)) $((s % 3600 / 60))
  elif ((s >= 60)); then printf '%d min' $((s / 60))
  else printf '%d s' "$s"; fi
}

html() { local s="$1"; s="${s//&/&amp;}"; s="${s//</&lt;}"; printf '%s' "${s//>/&gt;}"; }

telegram() {
  if [[ -z "${TELEGRAM_TOKEN:-}" || -z "${TELEGRAM_CHAT_ID:-}" ]]; then
    log "Telegram not configured (UPTIME_TELEGRAM_TOKEN / UPTIME_TELEGRAM_CHAT_ID): not sending"
    return 0
  fi
  # The URL (with the token) goes to curl as config on stdin, not as an
  # argument, so it never shows up in a process list; logs mask it anyway.
  if ! curl --silent --show-error --fail --max-time 20 --config - \
    --data-urlencode "chat_id=$TELEGRAM_CHAT_ID" --data-urlencode "text=$1" \
    --data "parse_mode=HTML" --data "disable_web_page_preview=true" -o /dev/null \
    <<<"url = \"https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage\""; then
    echo "::warning::Telegram refused the uptime message (check the token and chat id); retrying next run"
    return 1
  fi
}

declare -A prev_status prev_since
if [[ -f "$STATE_FILE" ]]; then
  while read -r name status since; do
    [[ -n "${name:-}" ]] || continue
    prev_status["$name"]="$status"
    prev_since["$name"]="${since:-$NOW}"
  done <"$STATE_FILE"
fi

changed=false
lines=()
summary="| Target | Expected | Got | State |"$'\n'"|---|---|---|---|"
while IFS='|' read -r name url expected; do
  [[ -n "${name// /}" ]] || continue
  log "checking $name ($url, want $expected)"
  if got="$(check "$url" "$expected")"; then state=up; else state=down; fi
  before="${prev_status[$name]:-up}" # first run: assume it was up
  since="${prev_since[$name]:-$NOW}"
  recorded="$state"
  if [[ "$state" != "$before" ]]; then
    if [[ "$state" == down ]]; then
      got_text="HTTP $got"
      [[ "$got" == 000 ]] && got_text="no answer"
      message="🔴 🌍 <b>$(html "$name") is down</b>"$'\n'"$(html "$url") → ${got_text} (want ${expected}), ${ATTEMPTS} tries."$'\n'"<i>From GitHub Actions; the server's own alerts can't see this.</i>"
    else
      message="✅ <b>Resolved</b> · 🌍 $(html "$name") is back"$'\n'"<i>Down for about $(duration $((NOW - since))).</i>"
    fi
    if telegram "$message"; then
      changed=true
      since="$NOW"
    else
      recorded="$before" # not delivered: keep the old state, so the next run tries again
    fi
  fi
  lines+=("$name $recorded $since")
  summary+=$'\n'"| $name | $expected | $got | $state |"
done <<<"$TARGETS"

# Targets removed from the list are simply dropped from the state.
mkdir -p "$(dirname "$STATE_FILE")"
printf '%s\n' "${lines[@]}" >"$STATE_FILE"
[[ -n "${GITHUB_OUTPUT:-}" ]] && echo "changed=$changed" >>"$GITHUB_OUTPUT"
[[ -n "${GITHUB_STEP_SUMMARY:-}" ]] && printf '%s\n' "$summary" >>"$GITHUB_STEP_SUMMARY"
log "$summary"
exit 0
