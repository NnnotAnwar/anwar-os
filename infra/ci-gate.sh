#!/usr/bin/env bash
# SSH forced command for the CI deploy key. In ~deploy/.ssh/authorized_keys:
#
#   command="/opt/anwar-os/repo/infra/ci-gate.sh",restrict ssh-ed25519 AAAA... github-actions-deploy
#
# `restrict` turns off port/agent/X11 forwarding and the pty; this script then
# allows exactly three commands, so a leaked CI key can only redeploy commits that
# are already on main (deploy.sh enforces that), never get a shell:
#
#   deploy <sha>      (also accepted as "<path>/deploy.sh <sha>")
#   rollback
#   status
set -euo pipefail

deny() {
  printf 'ci-gate: refused: %s\n' "$1" >&2
  exit 1
}

DEPLOY="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy.sh"

cmd="${SSH_ORIGINAL_COMMAND:-}"
[[ -n "$cmd" ]] || deny "no command (interactive login is not allowed)"
[[ "$cmd" =~ ^[A-Za-z0-9_./\ -]+$ ]] || deny "unexpected characters"

read -r -a argv <<<"$cmd"
case "${argv[0]}" in
  deploy | */deploy.sh) ;;
  rollback | status) argv=("deploy" "${argv[0]}") ;;
  *) deny "${argv[0]}" ;;
esac

[[ ${#argv[@]} -eq 2 ]] || deny "expected exactly one argument"
arg="${argv[1]}"
[[ "$arg" =~ ^([0-9a-f]{7,40}|rollback|status)$ ]] || deny "bad argument: $arg"

exec "$DEPLOY" "$arg"
