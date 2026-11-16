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

`{name}` is the compose service name. Errors: `401` bad signature, `404` not a
managed service, `403` protected, `409` busy/ambiguous, `400` bad input, `502`
Docker error or failed deploy.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `OPS_AGENT_SECRET` | required | shared HMAC secret, ≥ 32 chars |
| `OPS_AGENT_ADDR` | `:8080` | listen address |
| `OPS_AGENT_PROJECT` | (any) | only this compose project's containers |
| `OPS_AGENT_DEPLOY_TIMEOUT` | `240` | seconds to wait for a healthy new container |
| `OPS_AGENT_SETTLE` | `10` | seconds a container without a healthcheck must stay up |
| `OPS_AGENT_REGISTRY_USER` / `_TOKEN` / `_HOST` | — / — / `ghcr.io` | pull private images |
| `DOCKER_SOCKET` | `/var/run/docker.sock` | |

## Tests

```sh
cd services/ops-agent
go test ./...                                      # signing, rules, deploy logic (fake engine)
go test -tags integration -run Integration -v .   # against the local Docker daemon
```

Locally against Docker Desktop (socket group is 0 there):

```sh
docker build -t anwar-os-ops-agent:local services/ops-agent
docker run -d --name ops-agent-dev --group-add 0 -p 127.0.0.1:55470:8080 \
  -e OPS_AGENT_SECRET=$(openssl rand -hex 32) -e OPS_AGENT_PROJECT=<project> \
  -v /var/run/docker.sock:/var/run/docker.sock anwar-os-ops-agent:local
```
