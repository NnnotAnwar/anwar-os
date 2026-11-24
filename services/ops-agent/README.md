# ops-agent (`services/ops-agent`)

The control panel's hands: the only anwar.os process with `/var/run/docker.sock`.
`web` calls it over the internal network with HMAC-signed requests; it is never
published. Design: [ARCHITECTURE.md §8](../../docs/ARCHITECTURE.md), operations:
[DEPLOY.md §15](../../docs/DEPLOY.md).

**Why Go:** one static binary on `scratch` (~7 MB image, non-root, no shell),
cross-compiled for arm64/amd64 without emulation, and the standard library alone
covers HTTP, HMAC and a unix-socket client for the Docker Engine API. Zero
third-party modules on the one container that is root-equivalent on the host.

## API

All requests except `GET /healthz` need `X-OS-Timestamp`, `X-OS-Nonce` and
`X-OS-Signature: v1=<hex>`, see `internal/sign/sign.go` (web side:
`src/modules/ops/lib/sign.ts`; both share one test vector).

| Endpoint | Does |
|---|---|
| `GET /services` | managed containers: name, image, tag, revision, state, health, started_at, restart_count, protected, role, kind, cpu %, memory (`?stats=0` skips CPU/RAM) |
| `GET /services/{name}` | one service |
| `GET /services/{name}/logs?tail=200` | last lines (max 1000), stdout + stderr, with timestamps |
| `POST /services/{name}/start` `/stop` `/restart` | lifecycle; returns the new state |
| `POST /services/{name}/deploy` `{"tag":"<tag>"}` | pull, swap the container, wait for health, roll back on failure (`502` + `rolled_back`) |
| `GET /host` | the server's vital signs for Ops → Server (below) |

`{name}` is the compose service name. Errors: `401` bad signature, `404` not a
managed service, `403` protected, `409` busy/ambiguous, `400` bad input, `502`
Docker error or failed deploy.

### `GET /host`

Read-only, never fails as a whole: each section is `null` when its source
can't be read, with the reason in `errors` (`"not mounted"` for a missing bind
mount). Code: `internal/host`.

| Field | Source |
|---|---|
| `hostname`, `os`, `arch`, `cpus`, `docker_version` | Docker `GET /info` (the daemon runs on the host) |
| `kernel`, `uptime_seconds`, `boot_time`, `load` | `/proc/sys/kernel/osrelease`, `/proc/uptime`, `/proc/loadavg` of the agent's container: not namespaced, so they are the host's |
| `memory` (total, available, used, swap, `psi_*_avg60`) | `/proc/meminfo`, `/proc/pressure/memory` (host-wide) |
| `disk` (total, used, available, `used_percent` like `df`) | `statfs("/")`: the overlay root reports the filesystem holding `/var/lib/docker`, on the server the root disk (`OPS_AGENT_DISK_PATH` to change) |
| `docker_disk` (images, containers, volumes, build cache) | Docker `GET /system/df`, cached 10 min (it walks every volume) |
| `reboot` (`required`, `since`, `packages`) | `/host/run/reboot-required(.pkgs)`: the host's `/run`, bind-mounted read-only and **non-recursive** |
| `backup` (`last`, `last_success`) | `/host/backup/last.json`, `last-success.json`, written by `infra/backup/backup.sh` into `BACKUP_STATUS_DIR` (default `/var/backups/anwar-os-status`) |
| `sites` | hostnames of the top-level blocks in `/host/edge-sites/*.caddy` (`/opt/edge/sites`). web dials each on 443 with SNI and reads the certificate's expiry: the agent has no network route out (`internal` only) |

The mounts are in `infra/compose.prod.yml`; paths inside the container can be
changed with `OPS_AGENT_HOST_RUN`, `OPS_AGENT_BACKUP_STATUS_DIR`,
`OPS_AGENT_SITES_DIR`, `OPS_AGENT_PROC`.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `OPS_AGENT_SECRET` | required | shared HMAC secret, ≥ 32 chars |
| `OPS_AGENT_ADDR` | `:8080` | listen address |
| `OPS_AGENT_PROJECTS` | (any) | comma-separated compose projects to manage, e.g. `anwar-os,edge`. The first is primary: its services keep plain names (`web`), others are qualified (`edge.caddy`). `OPS_AGENT_PROJECT` (one project) still works |
| `OPS_AGENT_DEPLOY_TIMEOUT` | `240` | seconds to wait for a healthy new container |
| `OPS_AGENT_SETTLE` | `10` | seconds a container without a healthcheck must stay up |
| `OPS_AGENT_REGISTRY_USER` / `_TOKEN` / `_HOST` | — / — / `ghcr.io` | pull private images |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | |
| `OPS_AGENT_HOST_RUN` / `_BACKUP_STATUS_DIR` / `_SITES_DIR` | `/host/run` / `/host/backup` / `/host/edge-sites` | `GET /host` sources (bind mounts) |
| `OPS_AGENT_DISK_PATH` / `OPS_AGENT_PROC` | `/` / `/proc` | `GET /host`: filesystem for `disk`, procfs |

## On the server (first deploy with `GET /host`)

`deploy.sh` recreates ops-agent with the new mounts; nothing else is needed for
disk, memory, load, uptime, Docker usage, reboot and certificates. The backup
section appears after the next backup run with the new `backup.sh` (it writes
the status files); to see it right away:

```sh
sudo systemctl start anwar-os-backup.service   # ~1 min; writes /var/backups/anwar-os-status/last*.json
ls -l /var/backups/anwar-os-status/            # -rw-r--r-- last.json last-success.json
```

Docker Engine ≥ 25 is needed for the non-recursive `/run` mount
(`docker version --format '{{.Server.Version}}'`).

## Tests

```sh
cd services/ops-agent
go test ./...                                      # signing, rules, deploy logic (fake engine), host parsers
go test -tags integration -run Integration -v .   # against the local Docker daemon (incl. GET /host)
```

Locally against Docker Desktop (socket group is 0 there):

```sh
docker build -t anwar-os-ops-agent:local services/ops-agent
docker run -d --name ops-agent-dev --group-add 0 -p 127.0.0.1:55470:8080 \
  -e OPS_AGENT_SECRET=$(openssl rand -hex 32) -e OPS_AGENT_PROJECTS=<project> \
  -v /var/run/docker.sock:/var/run/docker.sock anwar-os-ops-agent:local
```
