#!/usr/bin/env bash
# Harden a fresh Ubuntu 24.04 LTS server for anwar.os. Idempotent: safe to re-run.
#
#   scp infra/bootstrap.sh root@SERVER:
#   ssh root@SERVER 'bash bootstrap.sh "ssh-ed25519 AAAA... you@laptop"'
#
# SSH public key for the `deploy` user, first match wins:
#   1. first argument (one key line)
#   2. $DEPLOY_SSH_PUBKEY
#   3. root's authorized_keys (the key you picked when ordering the server)
#
# Does: deploy user (sudo, docker), SSH keys-only + no root login, ufw (22/80/443),
# unattended security upgrades, fail2ban, Docker Engine + compose plugin from
# Docker's apt repo, timezone Europe/Prague, swap if RAM < 4 GB, /opt/anwar-os,
# and the shared edge for every project on the server: the `edge` Docker network,
# /opt/edge (Caddy's .env + per-project site files) and /srv/sites (static sites).
# Works on amd64 and arm64.
#
# Optional env:
#   DEPLOY_USER=deploy         user to create
#   TIMEZONE=Europe/Prague
#   SWAP_SIZE_GB=2             swap file size when RAM < SWAP_IF_RAM_BELOW_MB
#   SWAP_IF_RAM_BELOW_MB=4096
#   REBOOT_TIME=04:30          when unattended-upgrades may reboot (empty = never)
#   REPO_URL=https://github.com/NnnotAnwar/anwarnnnot.git   cloned to /opt/anwar-os/repo
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
TIMEZONE="${TIMEZONE:-Europe/Prague}"
SWAP_SIZE_GB="${SWAP_SIZE_GB:-2}"
SWAP_IF_RAM_BELOW_MB="${SWAP_IF_RAM_BELOW_MB:-4096}"
REBOOT_TIME="${REBOOT_TIME-04:30}"
REPO_URL="${REPO_URL:-https://github.com/NnnotAnwar/anwarnnnot.git}"
APP_DIR=/opt/anwar-os
export DEBIAN_FRONTEND=noninteractive

log() { printf '\n==> %s\n' "$*"; }
warn() { printf 'WARNING: %s\n' "$*" >&2; }
die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

# Write $2 to file $1 only if the content differs. Returns 0 if it changed.
write_if_changed() {
  local path="$1" content="$2" mode="${3:-0644}"
  if [[ -f "$path" ]] && [[ "$(cat "$path")" == "$content" ]]; then
    return 1
  fi
  install -m "$mode" /dev/null "$path"
  printf '%s\n' "$content" >"$path"
  return 0
}

# --------------------------------------------------------------------------
preflight() {
  [[ $EUID -eq 0 ]] || die "run as root"
  # shellcheck source=/dev/null
  . /etc/os-release
  if [[ "${ID:-}" != ubuntu || "${VERSION_ID:-}" != "24.04" ]]; then
    warn "tested on Ubuntu 24.04, this is ${PRETTY_NAME:-unknown}; continuing"
  fi
  CODENAME="${VERSION_CODENAME:-noble}"
  ARCH="$(dpkg --print-architecture)"
  case "$ARCH" in
    amd64 | arm64) ;;
    *) die "unsupported architecture: $ARCH" ;;
  esac
}

resolve_pubkey() {
  PUBKEY="${1:-${DEPLOY_SSH_PUBKEY:-}}"
  if [[ -z "$PUBKEY" && -s /root/.ssh/authorized_keys ]]; then
    PUBKEY="$(grep -E '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys || true)"
    [[ -n "$PUBKEY" ]] && log "using root's authorized_keys for $DEPLOY_USER"
  fi
  if [[ -z "$PUBKEY" ]] && [[ -s "/home/$DEPLOY_USER/.ssh/authorized_keys" ]]; then
    PUBKEY="$(cat "/home/$DEPLOY_USER/.ssh/authorized_keys")" # re-run
  fi
  [[ -n "$PUBKEY" ]] || die "no SSH public key: pass one as the first argument"
  grep -qE '^(ssh-(ed25519|rsa)|ecdsa-sha2-|sk-)' <<<"$PUBKEY" \
    || die "that doesn't look like an SSH public key"
}

packages() {
  log "apt: upgrade and base packages"
  apt-get update -q
  apt-get -y -q -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold upgrade
  apt-get -y -q install \
    ca-certificates curl gnupg git rsync jq ufw fail2ban \
    unattended-upgrades apt-listchanges age rclone
}

timezone() {
  log "timezone: $TIMEZONE"
  timedatectl set-timezone "$TIMEZONE"
}

deploy_user() {
  log "user: $DEPLOY_USER"
  if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    adduser --disabled-password --gecos "" "$DEPLOY_USER"
  fi
  usermod -aG sudo "$DEPLOY_USER"

  # The account has no password (keys only), so sudo must not ask for one. This
  # user is root-equivalent anyway through the docker group.
  local sudoers="/etc/sudoers.d/90-$DEPLOY_USER" tmp
  tmp="$(mktemp)"
  printf '%s ALL=(ALL) NOPASSWD:ALL\n' "$DEPLOY_USER" >"$tmp"
  chmod 0440 "$tmp"
  visudo -cf "$tmp" >/dev/null || die "generated sudoers rule is invalid"
  mv "$tmp" "$sudoers"

  local home="/home/$DEPLOY_USER"
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$home/.ssh"
  touch "$home/.ssh/authorized_keys"
  local key
  while IFS= read -r key; do
    [[ -z "$key" ]] && continue
    grep -qxF "$key" "$home/.ssh/authorized_keys" || printf '%s\n' "$key" >>"$home/.ssh/authorized_keys"
  done <<<"$PUBKEY"
  chown "$DEPLOY_USER:$DEPLOY_USER" "$home/.ssh/authorized_keys"
  chmod 600 "$home/.ssh/authorized_keys"
}

ssh_hardening() {
  log "sshd: keys only, no root login"
  # Ubuntu's sshd_config includes sshd_config.d/*.conf first and the first value
  # wins, so a 00- prefix beats cloud-init's 50-cloud-init.conf.
  local conf=/etc/ssh/sshd_config.d/00-anwar-os.conf
  write_if_changed "$conf" "# Managed by anwar.os infra/bootstrap.sh
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
PermitEmptyPasswords no
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowAgentForwarding no
ClientAliveInterval 300
ClientAliveCountMax 2" || true
  sshd -t || die "sshd config test failed; not reloading"
  # Ubuntu 24.04 socket-activates sshd; if the service isn't running, the next
  # connection starts it with the new config anyway.
  systemctl try-reload-or-restart ssh.service
}

firewall() {
  log "ufw: allow 22, 80, 443"
  ufw default deny incoming >/dev/null
  ufw default allow outgoing >/dev/null
  ufw limit 22/tcp comment "ssh" >/dev/null
  ufw allow 80/tcp comment "http (ACME + redirect)" >/dev/null
  ufw allow 443/tcp comment "https" >/dev/null
  ufw allow 443/udp comment "http/3" >/dev/null
  ufw --force enable >/dev/null
  ufw status verbose
}

auto_upgrades() {
  log "unattended-upgrades"
  write_if_changed /etc/apt/apt.conf.d/20auto-upgrades 'APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";' || true

  local reboot=false
  [[ -n "$REBOOT_TIME" ]] && reboot=true
  write_if_changed /etc/apt/apt.conf.d/52anwar-os-unattended "// Managed by anwar.os infra/bootstrap.sh
Unattended-Upgrade::Remove-Unused-Kernel-Packages \"true\";
Unattended-Upgrade::Remove-Unused-Dependencies \"true\";
Unattended-Upgrade::Automatic-Reboot \"$reboot\";
Unattended-Upgrade::Automatic-Reboot-Time \"${REBOOT_TIME:-04:30}\";" || true
  systemctl enable --now unattended-upgrades >/dev/null
}

fail2ban_setup() {
  log "fail2ban: sshd jail"
  if write_if_changed /etc/fail2ban/jail.d/anwar-os.local "# Managed by anwar.os infra/bootstrap.sh
[DEFAULT]
bantime = 1h
bantime.increment = true
findtime = 10m
maxretry = 5
banaction = ufw

[sshd]
enabled = true
backend = systemd"; then
    systemctl restart fail2ban
  fi
  systemctl enable --now fail2ban >/dev/null
}

docker_engine() {
  log "docker: engine + compose plugin from download.docker.com ($ARCH)"
  # Distro packages conflict with Docker's own; remove them if present.
  local pkg
  for pkg in docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc; do
    if dpkg -s "$pkg" >/dev/null 2>&1; then apt-get -y -q remove "$pkg"; fi
  done

  install -m 0755 -d /etc/apt/keyrings
  if [[ ! -s /etc/apt/keyrings/docker.asc ]]; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
  fi
  if write_if_changed /etc/apt/sources.list.d/docker.list \
    "deb [arch=$ARCH signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $CODENAME stable"; then
    apt-get update -q
  fi
  apt-get -y -q install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

  # Default log rotation for every container (compose sets its own too) and
  # live-restore so containers keep running while dockerd is upgraded.
  install -d -m 755 /etc/docker
  if write_if_changed /etc/docker/daemon.json '{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}'; then
    systemctl restart docker
  fi
  systemctl enable --now docker containerd >/dev/null
  usermod -aG docker "$DEPLOY_USER"
}

swap() {
  # A nominal "4 GB" plan reports ~3.8 GiB of MemTotal, so it gets swap too: on
  # purpose, Postgres + Next + bots on 4 GB benefit from a small cushion.
  local mem_kb
  mem_kb="$(awk '/^MemTotal:/ { print $2 }' /proc/meminfo)"
  if (( mem_kb >= SWAP_IF_RAM_BELOW_MB * 1024 )); then
    log "swap: ${mem_kb} kB RAM, not needed"
    return
  fi
  log "swap: RAM < 4 GB, ensuring ${SWAP_SIZE_GB}G /swapfile"
  if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then
    if [[ ! -f /swapfile ]]; then
      fallocate -l "${SWAP_SIZE_GB}G" /swapfile
      chmod 600 /swapfile
      mkswap /swapfile >/dev/null
    fi
    swapon /swapfile
  fi
  grep -qE '^/swapfile\s' /etc/fstab || printf '/swapfile none swap sw 0 0\n' >>/etc/fstab
  if write_if_changed /etc/sysctl.d/90-anwar-os-swap.conf 'vm.swappiness = 10'; then
    sysctl -q --system
  fi
}

app_dir() {
  log "app dir: $APP_DIR"
  install -d -m 750 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR"
  if [[ ! -d "$APP_DIR/repo/.git" ]]; then
    sudo -u "$DEPLOY_USER" git clone --quiet "$REPO_URL" "$APP_DIR/repo"
  fi
  install -d -m 700 /var/backups/anwar-os
}

# One Caddy (infra/edge/compose.yml) serves every project on this server. Each
# project writes /opt/edge/sites/<name>.caddy; static builds go to /srv/sites/<name>.
edge_dirs() {
  log "edge: /opt/edge, /srv/sites, docker network 'edge'"
  install -d -m 755 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /opt/edge /opt/edge/sites /srv/sites
  if [[ ! -f /opt/edge/.env ]]; then
    install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$APP_DIR/repo/infra/edge/.env.example" /opt/edge/.env
  fi
  docker network inspect edge >/dev/null 2>&1 || docker network create edge >/dev/null
}

summary() {
  cat <<EOF

Done. Before closing this root session, check in a NEW terminal that
    ssh $DEPLOY_USER@$(hostname -I | awk '{ print $1 }')
works: root login and passwords are now disabled.

Next steps (docs/DEPLOY.md):
  1. set ACME_EMAIL in /opt/edge/.env (Let's Encrypt account for every site here)
  2. cp $APP_DIR/repo/infra/.env.example $APP_DIR/repo/infra/.env, fill it, chmod 600
  3. docker login ghcr.io (as $DEPLOY_USER) unless the images are public
  4. $APP_DIR/repo/infra/deploy.sh <sha>   (starts the edge Caddy too)
  5. install the backup timer (docs/DEPLOY.md, "Backups")
EOF
}

main() {
  preflight
  resolve_pubkey "${1:-}"
  packages
  timezone
  deploy_user
  ssh_hardening
  firewall
  auto_upgrades
  fail2ban_setup
  docker_engine
  swap
  app_dir
  edge_dirs
  summary
}

main "$@"
