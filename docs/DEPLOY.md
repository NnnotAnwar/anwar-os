# Deploying anwar.os

From "order the server" to "`https://anwar-os.com` is live with a tested backup".
Architecture background: [ARCHITECTURE.md §3](ARCHITECTURE.md#3-infrastructure).

| | |
|---|---|
| Server | Hetzner Cloud **CAX21** (arm64, 4 vCPU / 8 GB), Ubuntu 24.04, Falkenstein or Nuremberg |
| Domain | `anwar-os.com` (DNS at the registrar; steps below use Vercel DNS — adapt if it lives elsewhere) |
| Files + backups | Hetzner Object Storage, same location as the server |
| Images | `ghcr.io/nnnotanwar/anwar-os-{web,migrate,bot-expenses,bot-osbot,ops-agent}:<sha>`, linux/arm64 + linux/amd64 |

## What's in the repo

| Path | Role |
|---|---|
| `Dockerfile` | `runner` target: Next.js standalone server (~75 MB compressed). `migrator` target: runs `pnpm db:migrate` / `pnpm owner:create` |
| `infra/compose.prod.yml` | `web`, `db`, `migrate` (one-shot), `bot-expenses` + `bot-osbot` (profile `bots`), `ops-agent` (profile `ops`) |
| `services/ops-agent/` | the control panel's Docker agent (Go, stdlib only, ~7 MB image) |
| `infra/edge/` | the **shared edge**: one Caddy for every project on the server (`compose.yml`, `Caddyfile` with the security-header snippet, site templates `sites/*.caddy.tmpl`) |
| `infra/.env.example` | every variable, documented. The real `.env` lives only on the server |
| `infra/bootstrap.sh` | hardens a fresh Ubuntu 24.04 (idempotent) |
| `infra/deploy.sh` | deploy / rollback / status on the server |
| `infra/ci-gate.sh` | SSH forced command for the CI key |
| `infra/backup/` | `backup.sh`, `restore.sh`, systemd service + timer |
| `.github/workflows/deploy.yml` | build multi-arch images (web, migrate, both bots) → GHCR → `deploy.sh <sha>` over SSH |
| `.github/workflows/infra.yml` | shellcheck + compose + Caddy config validation (edge + rendered sites) |

On the server everything lives in a checkout of this repo at `/opt/anwar-os/repo`
(public repo, cloned over HTTPS, no credentials). `deploy.sh` checks out the exact
commit it deploys, so the compose file, site template and `db/init` always match the
images. Run compose commands from `/opt/anwar-os/repo/infra`; this alias helps:

```sh
echo "alias dc='docker compose -f /opt/anwar-os/repo/infra/compose.prod.yml --env-file /opt/anwar-os/repo/infra/.env'" >> ~/.bash_aliases
echo "alias edge='docker compose -f /opt/anwar-os/repo/infra/edge/compose.yml --env-file /opt/edge/.env'" >> ~/.bash_aliases
```

### One server, several projects

The server is laid out to host more than anwar.os (next up: Shiftella, formerly Planuj Směny).
Ports 80/443 belong to the **edge** stack (`infra/edge/compose.yml`, compose
project `edge`): a single Caddy that gets certificates for every domain on the
server. Projects never publish ports. Each one:

- joins the external Docker network `edge` and gives its web container an alias
  (`anwar-os-web`), so names never clash between projects;
- writes its own site file to `/opt/edge/sites/<project>.caddy` and reloads
  Caddy (anwar.os: `deploy.sh` renders `infra/edge/sites/anwar-os.caddy.tmpl`);
- keeps its database and other services on its own internal network.

| On the server | What |
|---|---|
| `/opt/edge/.env` | `ACME_EMAIL` (Let's Encrypt account for all sites) |
| `/opt/edge/sites/*.caddy` | one file per project, written by that project's deploy |
| `/srv/sites/<project>/` | static builds served by the edge Caddy |
| `/opt/anwar-os/` | this project (repo checkout, `.env`, deploy history) |

Memory: the limits (`mem_limit:` per service) are ceilings, not reservations.
anwar.os is capped at ~4 GB (web 1 GB, db 1.5 GB, each bot 256 MB, ops-agent,
`migrate` only while deploying), Caddy 256 MB. Real use is far lower: on the
current CAX11 (4 GB + 2 GB swap) the whole server idles around 1 GB with both
bots on, and a static SPA like Shiftella adds nothing. Move to a CAX21 (Rescale,
"CPU and RAM only") when that changes.

---

## 1. Before you start (on your laptop)

1. **SSH key** for yourself, if you don't have one: `ssh-keygen -t ed25519`.
2. **age key pair for backups** (`brew install age`):
   ```sh
   age-keygen -o ~/anwar-os-backup.key     # prints "Public key: age1..."
   ```
   Store `anwar-os-backup.key` in your password manager **and** somewhere offline
   (printed, or a USB stick). Without it the backups are unreadable. Only the
   public `age1...` line goes on the server.
3. A **separate SSH key for CI** (step 9): `ssh-keygen -t ed25519 -f ~/.ssh/anwar-os-ci -C github-actions-deploy -N ""`.

## 2. Order the server

Hetzner Cloud console → your project → **Add server**:

- Location: **Falkenstein (fsn1)** or **Nuremberg (nbg1)**. Use the same one for
  Object Storage.
- Image: **Ubuntu 24.04**. Type: **Arm64 (Ampere) → CAX21**.
- Networking: public IPv4 + IPv6.
- SSH key: add your **personal** public key (bootstrap copies it to the `deploy` user).
- Optional: Hetzner **Backups** (+20 %, whole-disk snapshots; complements, doesn't
  replace, the database backups) and a Hetzner **Firewall** allowing only TCP 22,
  80, 443 and UDP 443 (defense in depth on top of ufw).
- Name: `anwar-os`.

Note the IPv4 and IPv6 addresses (`<IPV4>`, `<IPV6>`; for IPv6 use the `::1`
address of the assigned /64).

## 3. DNS records (Vercel)

The domain was bought at Vercel, so its nameservers are Vercel's. Add the records
in the Vercel dashboard → **Domains → anwar-os.com → DNS Records**, or with the
CLI:

| Name | Type | Value | TTL |
|---|---|---|---|
| `@` (apex) | A | `<IPV4>` | 60 at first, later 3600 |
| `@` | AAAA | `<IPV6>` | same |
| `www` | A | `<IPV4>` | same |
| `www` | AAAA | `<IPV6>` | same |
| `@` | CAA | `0 issue "letsencrypt.org"` | optional, limits who may issue certs |

```sh
vercel dns add anwar-os.com @ A <IPV4>
vercel dns add anwar-os.com @ AAAA <IPV6>
vercel dns add anwar-os.com www A <IPV4>
vercel dns add anwar-os.com www AAAA <IPV6>
vercel dns add anwar-os.com @ CAA '0 issue "letsencrypt.org"'
```

- If the domain is attached to a Vercel **project**, remove it there first
  (Project → Settings → Domains); otherwise Vercel keeps serving its own default
  A/ALIAS/CNAME records (`76.76.21.21`, `cname.vercel-dns.com`) for the apex/www.
  Delete any such records so only the ones above remain.
- Keep the MX/TXT records if you use the domain for email.
- `www` is redirected to the apex by Caddy (it needs its own certificate, hence its
  own records).
- Check from your laptop before the first start: `dig +short anwar-os.com A`,
  `dig +short www.anwar-os.com AAAA` must return the server's addresses.

## 4. Bootstrap the server

```sh
scp infra/bootstrap.sh root@<IPV4>:
ssh root@<IPV4> 'bash bootstrap.sh'            # uses root's authorized_keys
# or pass a key explicitly: bash bootstrap.sh "ssh-ed25519 AAAA... you@laptop"
```

It creates the `deploy` user (sudo without password — it has no password — and in
the `docker` group), disables root login and password auth, enables ufw (22 rate
limited, 80, 443/tcp, 443/udp), unattended security upgrades (reboots at 04:30 when
needed), fail2ban for sshd, Docker Engine + compose plugin from Docker's apt repo
(arm64 or amd64), timezone Europe/Prague, swap if RAM < 4 GB (not on a CAX21),
installs `age`, `rclone`, `git`, clones the repo to `/opt/anwar-os/repo`, and
prepares the shared edge: the `edge` Docker network, `/opt/edge` (with `.env`
from the example), `/opt/edge/sites` and `/srv/sites`.

**Before closing the root session**, open a new terminal and check
`ssh deploy@<IPV4>` works. Re-running the script is safe.

Docker publishes ports through its own iptables rules, bypassing ufw. That's fine
here (only the edge Caddy publishes 80/443), but never add `ports:` to `db` or other
services; keep them on the internal network.

## 5. Object Storage

Hetzner Cloud console → **Object Storage**, same location as the server:

1. Create two **private** buckets, e.g. `anwar-os-files` (app files, phase 4) and
   `anwar-os-backups`. (One bucket also works: backups then go under
   `BACKUP_PREFIX`, default `postgres/`.)
2. **Security → S3 credentials → Generate**. Note the access key and secret
   (shown once). Hetzner credentials are project-wide; for a hard separation keep
   backups in a different Hetzner project with its own key and set
   `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY`.
3. Endpoint: `https://fsn1.your-objectstorage.com` (or `nbg1`), region `fsn1`.

## 6. Configure `.env`

```sh
ssh deploy@<IPV4>
cd /opt/anwar-os/repo/infra
cp .env.example .env && chmod 600 .env
nano .env
```

First the edge (once per server, shared by every project):

```sh
nano /opt/edge/.env        # ACME_EMAIL=you@example.com
```

Then anwar.os. Fill in (`.env.example` explains each one): `DOMAIN=anwar-os.com`,
`POSTGRES_PASSWORD` and `OS_APP_PASSWORD` (`openssl rand -hex 32`),
`BETTER_AUTH_SECRET` (`openssl rand -base64 32`), the `S3_*` values,
`BACKUP_S3_BUCKET`, `BACKUP_AGE_RECIPIENT` (the `age1...` public key). Leave the bot
section for later. Save a copy of the finished file in your password manager.

`.env` belongs to `deploy` with mode 600. `deploy` is root-equivalent anyway (docker
group), so this is the "root-only" secret file from the architecture in practice;
the backup timer reads it as root.

## 7. First deploy

Images must exist in GHCR first: merge to `main` (or run the **Deploy** workflow
manually) and wait for the "Publish multi-arch tags" job. The deploy job is skipped
until the `DEPLOY_*` secrets exist (step 9).

**Registry access.** GHCR packages start private. Either make the three packages
public (GitHub → your profile → Packages → each package → Package settings →
Change visibility; the code is public anyway), or log the server in once with a
classic PAT that has only `read:packages`:

```sh
echo <PAT> | docker login ghcr.io -u NnnotAnwar --password-stdin   # as deploy
```

Then, as `deploy`:

```sh
/opt/anwar-os/repo/infra/deploy.sh <full commit sha from main>
```

This starts Postgres (creating `os_app` via `db/init/01-roles.sh` on the empty
volume), runs migrations, starts `web` and waits for `/api/health`, then writes
`/opt/edge/sites/anwar-os.caddy`, starts the edge Caddy if it isn't running and
reloads it. Caddy requests certificates for `anwar-os.com` and `www.anwar-os.com`
(watch with `edge logs -f caddy`). Open `https://anwar-os.com`.

## 8. First owner

Sign-up is disabled; create the owner with the migrate image (it has the full
toolchain and `MIGRATION_DATABASE_URL`):

```sh
cd /opt/anwar-os/repo/infra
docker compose -f compose.prod.yml run --rm migrate pnpm owner:create you@example.com
# prompts for a password (min 12 chars)
```

Sign in at `https://anwar-os.com/login`, then in **Settings → Sign-in methods**:
set up two-factor (store the backup codes), and add a passkey on each device you
use (a passkey sign-in counts as two factors, so it skips the code). Optionally
connect Google (see "Google sign-in" below). Phase 2 is done when `/app` works with
2FA and a backup has been restored (step 11).

### Google sign-in (optional)

Google can sign the owner in only after the Google account was connected in
Settings while signed in; it never creates a user and never matches accounts by
email. With 2FA on, the code is still asked after Google. Leave
`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` empty to hide Google entirely.

In [Google Cloud Console](https://console.cloud.google.com/):

1. Create (or pick) a project, e.g. `anwar-os`.
2. **APIs & Services → OAuth consent screen** (Google Auth Platform → Branding):
   app name `anwar.os`, support email, authorized domain `anwar-os.com`,
   developer contact. **Audience:** External. Scopes: only `openid`, `email`,
   `profile` (the defaults; no verification needed). While the app is in
   *Testing*, add your Google address under **Test users**; or press
   **Publish app** (basic scopes publish without review).
3. **Credentials → Create credentials → OAuth client ID → Web application**,
   name `anwar.os web`:
   - Authorized JavaScript origins: `https://anwar-os.com`
   - Authorized redirect URIs: `https://anwar-os.com/api/auth/callback/google`
   - (for local testing, a second client with `http://localhost:3000` and
     `http://localhost:3000/api/auth/callback/google`)
4. Copy the client ID and secret into `infra/.env` as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, save them in your password manager, redeploy.
5. Sign in, **Settings → Sign-in methods → Google → Connect** (needs a sign-in
   from the last hour; otherwise "Confirm it's you" first). The Google account's
   email must be verified; it may differ from the owner email.

To revoke: Settings → Disconnect, and/or delete the client in Cloud Console.

## 9. Automatic deploys from GitHub

1. On the server, add the CI key with a forced command, so it can only run
   `deploy.sh` for commits already on `main` (never get a shell):
   ```sh
   echo 'command="/opt/anwar-os/repo/infra/ci-gate.sh",restrict ssh-ed25519 AAAA...(contents of anwar-os-ci.pub) github-actions-deploy' >> ~/.ssh/authorized_keys
   ```
2. Repository → Settings → Secrets and variables → Actions, **repository** secrets
   (not environment secrets: the plan job checks for them):
   - `DEPLOY_HOST` = `<IPV4>` (or `anwar-os.com`)
   - `DEPLOY_USER` = `deploy`
   - `DEPLOY_SSH_KEY` = contents of `~/.ssh/anwar-os-ci` (private key)
   - `DEPLOY_KNOWN_HOSTS` = output of `ssh-keyscan -t ed25519 <IPV4>`, after
     checking the fingerprint matches `ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub`
     on the server (without it, CI trusts the host key on first use and warns)
   - optional `DEPLOY_PORT` if SSH isn't on 22
3. Variables: `PUBLIC_URL` = `https://anwar-os.com` (enables the post-deploy smoke test).
4. Optional: Settings → Environments → `production` → required reviewers, if you
   want to approve each deploy.

From now on every push to `main` builds `web`, `migrate` and `bot-expenses` for
arm64 + amd64 on native runners, tags them `:<sha>` and `:latest`, and runs
`deploy.sh <sha>`:

1. `git checkout <sha>` (must be on `origin/main`), set `WEB_TAG` (and
   `BOT_EXPENSES_TAG` if bots are on) in `.env`, pull images.
2. `docker compose run --rm migrate`. If it fails, web is never touched.
3. Recreate `web`, wait for its healthcheck (`/api/health` = Postgres reachable).
   If it doesn't become healthy, the previous commit and image are restored.
4. Render the site file into `/opt/edge/sites`, reload the edge Caddy (a
   rejected config keeps the previous file and fails the deploy), record the sha in `infra/.deploy-history`, then deploy the bot.

The images carry no secrets and no environment; one image runs anywhere.

## 10. Backups

Install the nightly timer (03:15 Prague time, ±15 min) as `deploy`:

```sh
cd /opt/anwar-os/repo
sudo install -m 644 infra/backup/anwar-os-backup.service infra/backup/anwar-os-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now anwar-os-backup.timer
sudo systemctl start anwar-os-backup.service        # run one now
journalctl -u anwar-os-backup.service -n 30         # "backup OK: ..."
```

What it does: `pg_dump --format=custom` inside the `db` container, streamed through
`age` (no plaintext on disk) to `/var/backups/anwar-os/` (2 newest kept locally),
uploaded with rclone to `s3://<BACKUP_S3_BUCKET>/postgres/daily/`. The first backup
of each ISO week and month is also copied to `weekly/` and `monthly/`. Retention:
7 daily, 4 weekly, 6 monthly (`BACKUP_KEEP_*`).

Optional but recommended: create a free check at healthchecks.io (daily period,
2 h grace) and put its URL in `BACKUP_PING_URL`, so you hear about a backup that
silently stopped.

**Storage Box instead of Object Storage:** order a Storage Box, create a
sub-account with SSH key login, put the private key at `/root/.ssh/storagebox`, and
set `BACKUP_TARGET=sftp` plus the `BACKUP_SFTP_*` variables in `.env`. Everything
else is the same (rclone speaks both).

Not in the database backup: `.env` and `/opt/edge/.env` (password manager), Caddy's certificates
(re-issued automatically), container images (rebuilt by CI), and app files in
Object Storage (phase 4; enable bucket versioning or a second sync then).

## 11. Restore drill (do it now, then monthly)

Untested backups don't count. The drill restores into a scratch database next to
production and never touches the live one:

```sh
scp ~/anwar-os-backup.key deploy@<IPV4>:/tmp/k     # from the laptop
ssh deploy@<IPV4>
sudo /opt/anwar-os/repo/infra/backup/restore.sh -i /tmp/k latest
# downloads daily/<newest>, decrypts, pg_restore into anwar_os_restore,
# prints every table with its row count, drops the scratch database
shred -u /tmp/k
```

Check the row counts look right (`auth.user` has your owner, notes are there).
`restore.sh -i /tmp/k weekly/anwar_os-2026-W47.dump.age` restores a specific file;
a local path works too.

Laptop variant (keeps the private key off the server):

```sh
export RCLONE_CONFIG_HOS_TYPE=s3 RCLONE_CONFIG_HOS_PROVIDER=Other \
  RCLONE_CONFIG_HOS_ENDPOINT=https://fsn1.your-objectstorage.com \
  RCLONE_CONFIG_HOS_ACCESS_KEY_ID=... RCLONE_CONFIG_HOS_SECRET_ACCESS_KEY=...
rclone lsf hos:anwar-os-backups/postgres/daily/
rclone copyto hos:anwar-os-backups/postgres/daily/<file> ./b.age
docker run -d --name restore-test -e POSTGRES_PASSWORD=x postgres:17-alpine
sleep 5
# --no-owner/--no-acl: the app roles don't exist in this throwaway cluster
age -d -i ~/anwar-os-backup.key b.age \
  | docker exec -i restore-test pg_restore -U postgres -d postgres --create --no-owner --no-acl
docker exec restore-test psql -U postgres -d anwar_os -c 'select count(*) from auth."user"'
docker rm -f restore-test && rm b.age
```

### Real restore (data loss, bad migration)

```sh
sudo /opt/anwar-os/repo/infra/backup/restore.sh -i /tmp/k --into-live latest
```

Stops `web` (and the bot), saves an encrypted safety dump of the current database
to `/var/backups/anwar-os/pre-restore-*.dump.age`, drops and recreates `anwar_os`
from the backup (including database-level grants), re-applies the bot's role
password, starts everything and waits for health.

### Rebuild the server from scratch

New server → steps 2–6 (restore `.env` and `/opt/edge/.env` from the password manager, update DNS if the
IP changed) → `deploy.sh <sha>` (creates an empty, migrated database) →
`restore.sh --into-live latest` → install the backup timer. Caddy gets new
certificates on its own.

## 12. Rollback

- **Automatic:** a deploy whose `web` container fails its healthcheck restores the
  previous commit and image itself; the workflow run goes red.
- **Previous release:** `ssh deploy@<IPV4> /opt/anwar-os/repo/infra/deploy.sh rollback`
  (the sha before the current one in `.deploy-history`).
- **Any earlier release:** `deploy.sh <sha>`, or GitHub → Actions → Deploy →
  **Run workflow** with `sha` set (skips the build, redeploys that image; works from
  the phone).
- `deploy.sh status` shows the deployed commit, tags, containers and last deploys.

Migrations are **not** rolled back. Keep them expand/contract (add first, drop in a
later release), so the previous image works against the newer schema. If a
migration destroyed data, restore the pre-deploy backup (`--into-live`) and then
deploy the previous sha.

## 13. Expense bot

1. Stop the old `py-telegram` bot (only one process may poll a token).
2. In `.env`: `BOT_EXPENSES_TOKEN`, `BOT_EXPENSES_DB_PASSWORD` (`openssl rand -hex 24`),
   `COMPOSE_PROFILES=bots`.
3. `deploy.sh <current sha>`. With the profile on, deploy.sh applies
   `bots/expenses/db/bootstrap.sql` (role `bot_expenses`, schema, grants;
   idempotent, also syncs the password), starts `bot-expenses` and waits for its
   heartbeat healthcheck. The bot migrates its own tables at startup.
4. Optional import of the old SQLite data (see `bots/expenses/README.md`):
   ```sh
   cd /opt/anwar-os/repo/infra
   docker compose -f compose.prod.yml run --rm -v /path/to/expenses.db:/data/expenses.db:ro \
     bot-expenses python scripts/import_sqlite.py /data/expenses.db --dry-run
   ```

A bot that fails its healthcheck is rolled back to its previous tag; web stays on
the new release. With the profile on, deploy.sh skips a bot whose settings are
empty, so either bot can run alone.

## 14. Connect osbot

osbot is your own bot for the platform (`bots/osbot/README.md`): quick capture
(forward anything → Inbox, task, note, link, idea), `/today`, calendar reminders
("⏰ Dentist in 30 min · 14:00") and new-feedback alerts. It only ever answers
your chat. It has no database access: it calls web's internal API
(`/api/internal/osbot/*`, HMAC-signed, never reachable through Caddy) over the
stack's internal network.

1. **Create the bot.** In Telegram, open @BotFather → `/newbot` → pick a name
   ("anwar.os") and a username ending in `bot`. Copy the token. Optional, in the
   same chat: `/setprivacy` → Disable is *not* needed (it's a private chat);
   `/setjoingroups` → Disable, so nobody can add it to groups.
2. **Find your chat id.** Send your new bot any message, then on your laptop:
   ```sh
   curl -s "https://api.telegram.org/bot<token>/getUpdates" | grep -o '"chat":{"id":[0-9-]*'
   ```
   The number is `OSBOT_OWNER_CHAT_ID` (for a private chat it equals your user
   id). Do this before step 4: once osbot polls, `getUpdates` returns nothing
   for you.
3. **Configure** in `infra/.env` on the server:
   ```sh
   OSBOT_TOKEN=<token>
   OSBOT_OWNER_CHAT_ID=<chat id>
   OSBOT_API_SECRET=$(openssl rand -hex 32)   # paste the value, not the command
   COMPOSE_PROFILES=bots
   ```
4. `deploy.sh <current sha>`. web restarts with `OSBOT_API_SECRET` (the internal
   API is off without it), then `bot-osbot` starts and deploy.sh waits for its
   healthcheck, which turns healthy only after web accepted its first signed
   heartbeat: token, secret, network and owner account all work.
5. Check: send `/today` to the bot. **Settings → Telegram** in the app shows
   "Connected" with the last heartbeat.

Feedback alerts: while osbot's heartbeat is fresh (under 3 minutes) it sends
them; otherwise web sends them itself through the Bot API with the same token,
so alerts keep working while the bot is down. Each alert is sent once either way.

Rotating the secret: change `OSBOT_API_SECRET`, `deploy.sh <current sha>` (web
and bot restart together). Rotating the token: `/revoke` in @BotFather, update
`OSBOT_TOKEN`, deploy.

## 15. Control panel (ops-agent)

`/app/ops` shows every `os.managed=true` container of the `anwar-os` compose
project (state, health, uptime, tag, restarts, CPU/RAM), tails logs, starts /
stops / restarts, and deploys another image tag. `/app/bots` adds bot stats.
Web never touches Docker: it signs requests to `ops-agent`, the only container
with `/var/run/docker.sock`, on the `internal` network (no ports, no internet).

1. In `.env`: `OPS_AGENT_SECRET` (`openssl rand -hex 32`),
   `OPS_AGENT_URL=http://ops-agent:8080`, and add `ops` to `COMPOSE_PROFILES`
   (e.g. `COMPOSE_PROFILES=bots,ops`).
2. `deploy.sh <current sha>`. It pulls `anwar-os-ops-agent:<sha>`, starts it
   after web and waits for its healthcheck. `DOCKER_GID` is read from the socket
   (set it in `.env` for hand-run `dc up`).
3. Open `/app/ops`: the cards list web, db, ops-agent, the edge Caddy (as
   `edge.caddy`; all protected) and
   the bots. Every action lands in "Activity" (table `ops_events`).

**Rules** (enforced by the agent, not the UI): only `os.managed=true` containers
of the projects in `OPS_AGENT_PROJECTS` (default `anwar-os,edge`) exist for it (one-off `compose run` containers don't);
`os.protected=true` ones (edge.caddy, web, db, ops-agent) can be restarted but never
stopped or deployed; a deploy can only switch the tag of the image the service
already runs. Requests are HMAC-SHA256 signed over timestamp, nonce, method,
path and body; the agent refuses anything older than 60 s or a reused nonce.

**Deploys from the panel** pull `repo:<tag>`, park the old container as
`<name>-ops-previous`, start a copy of it on the new tag (same env, limits,
networks and compose labels), wait for its healthcheck (`OPS_AGENT_DEPLOY_TIMEOUT`,
default 240 s), then remove the old one, or put the old one back if the new one
fails. The tag in `.env` is **not** changed: the next `deploy.sh` (every push to
main) or a hand-run `dc up -d <service>` brings the service back to the `.env`
tag. Use the panel for hotfix rollbacks and bot redeploys; use git for the rest.

If the agent died mid-deploy (rare), a stopped `<name>-ops-previous` may be left:
`docker rm -f <name>-ops-previous` and `dc up -d <service>`.

The deploy dialog lists tags from GHCR (anonymous for public packages) and
matches sha tags to commits of `GITHUB_REPO` for the message and date. Set
`GITHUB_TOKEN` (read:packages) if the packages are private; then also set
`OPS_AGENT_REGISTRY_USER` / `OPS_AGENT_REGISTRY_TOKEN` so the agent can pull.

## 16. Day-2 notes

- Logs: `dc logs -f web`, `edge logs --tail 200 caddy`. Docker rotates them
  (10 MB × 5 per container).
- `dc ps` shows health; `/api/health` is public for uptime monitors.
- **Locked out of SSH ("Connection refused")?** fail2ban bans an address for
  an hour after 5 failed logins (a few `ssh root@…` tries after bootstrap are
  enough, since root login is off). Wait it out, or unban from the Hetzner web
  console: Rescue → Reset root password → console `>_` → log in as root →
  `fail2ban-client set sshd unbanip <your IP>` → `passwd -l root`.
- Editing on the server over SSH: `ssh -t deploy@<IPV4> nano <file>` (`-t`
  for a terminal). Ghostty users: copy its terminfo once, or nano refuses to
  start (`Error opening terminal: xterm-ghostty`):
  `TERMINFO=/Applications/Ghostty.app/Contents/Resources/terminfo infocmp -x xterm-ghostty | ssh deploy@<IPV4> -- tic -x -`.
- `deploy.sh` takes the **full** 40-character sha (`git rev-parse origin/main`).
- **Labels:** services carry `os.managed=true` (listed by ops-agent),
  `os.protected=true` (visible but not stoppable/deployable from the panel: the
  edge Caddy, web, db), `os.role` (edge/app/data/bot); bot images add `os.kind=bot` and
  `os.name`. One-shot jobs are `os.managed=false`.
- Updating Caddy: bump the tag in `infra/edge/compose.yml`, then
  `edge pull && edge up -d` (a second or two without HTTPS for every site).
  Reload after editing a site file by hand:
  `edge exec caddy caddy reload --config /etc/caddy/base/Caddyfile --adapter caddyfile`. Postgres minor
  updates: `dc pull db && dc up -d db`. A **major** upgrade (17 → 18) needs a dump
  and restore into a new volume; don't just change the tag.
- Rotating `BETTER_AUTH_SECRET` signs everyone out. Rotating a database password:
  `ALTER ROLE ... PASSWORD` first (via `dc exec db psql -U postgres`), then `.env`,
  then `deploy.sh <current sha>`.
- IPv6 visitors reach Caddy through Docker's userland proxy, so Caddy logs show a
  Docker gateway address for them instead of the real client IP.
- That shared IPv6 address also means sign-in rate limits (per address) are
  shared by every IPv6 visitor; the per-account limit still applies. See
  "Security headers and limits" below.

## 17. Security headers and limits

Each header is set in exactly one place, so nothing is sent twice with
different values:

| Header | Where | Value / notes |
|---|---|---|
| `Strict-Transport-Security` | `infra/edge/Caddyfile` | 1 year, `includeSubDomains` |
| `X-Content-Type-Options` | `infra/edge/Caddyfile` | `nosniff` |
| `Referrer-Policy` | `infra/edge/Caddyfile` | `strict-origin-when-cross-origin` (the files `raw` route sends `no-referrer` itself) |
| `X-Frame-Options` | `infra/edge/Caddyfile` | `DENY`, for old browsers; the CSP's `frame-ancestors 'none'` says the same |
| `Cross-Origin-Opener-Policy` | `infra/edge/Caddyfile` | `same-origin` |
| `Permissions-Policy` | `infra/edge/Caddyfile` | camera, microphone, geolocation, payment, usb off (passkeys use WebAuthn, which isn't listed, so it stays allowed) |
| `Server`, `X-Powered-By` | removed by Caddy | Next's `X-Powered-By` is also off (`poweredByHeader: false`) |
| `Content-Security-Policy` (pages) | `src/proxy.ts` → `src/core/csp.ts` | per request, fresh nonce: `script-src 'self' 'nonce-…' 'strict-dynamic'`, Fontshare for styles/fonts, `https:` images, the `S3_ENDPOINT` origin (and `bucket.host` when not path-style) for uploads and previews, `frame-ancestors 'none'`, `upgrade-insecure-requests` |
| `Content-Security-Policy` (`/sw.js`, `/offline.html`) | `next.config.ts` | static strict policies; these files skip the proxy |
| `Cache-Control` for `/sw.js` | `next.config.ts` | `no-cache`, so a deploy's worker is picked up |

Why every page renders per request: Next stamps the nonce on its scripts only
while rendering. A prerendered (PPR) shell was built without one, and its
scripts would be blocked, so the root layout reads the nonce (`headers()`) and
opts out of the static shell (`instant = false`). Suspense still streams and
`use cache` data stays cached. Changing the S3 endpoint needs no rebuild: the
proxy reads `S3_*` at request time.

**Sign-in rate limits** live in Postgres (`auth.rate_limit`), so a deploy's
restart doesn't reset them:

- password sign-in (server action): 10 attempts per address and 20 per account
  per 15 minutes; 2FA codes: 10 per address per 15 minutes;
- Better Auth's own limiter for `/api/auth/*` (passkeys, Google, the HTTP
  sign-in endpoints): its built-in rules (3 per 10 s on sign-in and 2FA routes,
  100 per 10 s elsewhere), stored in the same table.

Both are on when `NODE_ENV=production`; `AUTH_RATE_LIMIT=off` (or `on`) in
`.env` overrides that. The client address is the last `X-Forwarded-For` entry,
which Caddy sets.

## 18. A second project on this server

A **static SPA** needs no container at all; the edge Caddy serves the files.
Shiftella (formerly Planuj Směny: React + Vite, backend on hosted Supabase) is
the first one:

1. DNS: A/AAAA for its domain (and `www`) → this server. On Cloudflare keep the
   records **DNS only** (grey cloud) so Caddy gets its own certificates.
2. Builds go to `/srv/sites/shiftella/{prod,dev}/releases/<sha>`, and a
   `current` symlink points at the live one (the project's own release script
   swaps it atomically; rollback = point it back). Upload from CI with a
   separate SSH key whose forced command only allows that.
3. Site file, once (the project may ship its own instead, with its CSP):
   ```sh
   cd /opt/anwar-os/repo/infra/edge/sites
   sed -e 's|__DOMAIN__|shiftella.app|g' -e 's|__ROOT__|shiftella/prod/current|g' \
     static-spa.caddy.tmpl > /opt/edge/sites/shiftella.caddy
   edge exec caddy caddy reload --config /etc/caddy/base/Caddyfile --adapter caddyfile
   ```
   `index.html` and other non-asset files are served `no-cache`, hashed
   `/assets/*` are immutable, and a missing asset is a real 404.

A project **with its own containers** follows the anwar.os pattern: its own
directory in `/opt/<project>`, its own compose project name, no `ports:`, web on
the external `edge` network with an alias `<project>-web`, `mem_limit:` on every
service, and its deploy writing `/opt/edge/sites/<project>.caddy` then reloading
Caddy. Add the project to `OPS_AGENT_PROJECTS` in anwar.os's `.env` (e.g.
`anwar-os,edge,myproject`) to manage it from `/app/ops`; its services show up
as `myproject.web` and so on.
