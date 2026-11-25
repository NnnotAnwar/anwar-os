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
| `infra/backup/` | `backup.sh`, `restore.sh`, `drill.sh` (the restore drill), systemd service + timer |
| `.github/workflows/deploy.yml` | build multi-arch images (web, migrate, both bots) → GHCR → `deploy.sh <sha>` over SSH |
| `.github/workflows/infra.yml` | shellcheck + compose + Caddy config validation (edge + rendered sites) |
| `.github/workflows/uptime.yml`, `infra/uptime/check.sh` | external uptime checks every 10 min, Telegram on down/back (§19) |
| `.github/workflows/restore-drill.yml` | the monthly restore drill: newest backup → throwaway Postgres → checks → Ops → Server (§11) |

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
4. **CORS on the files bucket** (after `.env` is filled, step 6). Browsers upload
   straight to the bucket with a presigned PUT, so without a CORS rule every
   upload fails at the preflight (403). Allow only the site's origin:
   ```sh
   cd /opt/anwar-os/repo/infra
   get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2-; }
   printf '{"CORSRules":[{"AllowedOrigins":["https://%s"],"AllowedMethods":["PUT","GET","HEAD"],"AllowedHeaders":["*"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]}' "$(get DOMAIN)" > /tmp/cors.json
   docker run --rm -v /tmp/cors.json:/cors.json:ro \
     -e AWS_ACCESS_KEY_ID="$(get S3_ACCESS_KEY_ID)" -e AWS_SECRET_ACCESS_KEY="$(get S3_SECRET_ACCESS_KEY)" \
     -e AWS_DEFAULT_REGION="$(get S3_REGION)" amazon/aws-cli:2.22.35 --endpoint-url "$(get S3_ENDPOINT)" \
     s3api put-bucket-cors --bucket "$(get S3_BUCKET)" --cors-configuration file:///cors.json
   rm /tmp/cors.json
   ```
   (aws-cli 2.22: newer versions send CRC checksums Hetzner doesn't accept.)
   Check: a preflight with `Origin: https://anwar-os.com` must answer 200.

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

Every run also writes its outcome to `/var/backups/anwar-os-status/`
(`BACKUP_STATUS_DIR`): `last.json` (latest run, `ok` or `failed` with the step
that failed) and `last-success.json` (time, file, size, whether it reached
off-site storage). Mode 644, no secrets; ops-agent reads them for **Ops →
Server** and osbot alerts when the last run failed or the last good one is
older than 26 h (§19).

Optional but recommended: create a free check at healthchecks.io (daily period,
2 h grace) and put its URL in `BACKUP_PING_URL`, so you hear about a backup that
silently stopped, even with the server down (§19 has the steps).

**Storage Box instead of Object Storage:** order a Storage Box, create a
sub-account with SSH key login, put the private key at `/root/.ssh/storagebox`, and
set `BACKUP_TARGET=sftp` plus the `BACKUP_SFTP_*` variables in `.env`. Everything
else is the same (rclone speaks both).

Not in the database backup: `.env` and `/opt/edge/.env` (password manager), Caddy's certificates
(re-issued automatically), container images (rebuilt by CI), and app files in
Object Storage (phase 4; enable bucket versioning or a second sync then).

## 11. Restore drill (monthly, automatic)

Untested backups don't count. On the 2nd of every month (and whenever you press
**Actions → Restore drill → Run workflow**) GitHub Actions restores the newest
nightly backup into a throwaway Postgres on its runner and checks it
(`.github/workflows/restore-drill.yml` → `infra/backup/drill.sh`):

| Check | Passes when |
|---|---|
| restore | the file decrypts and `pg_restore --exit-on-error` succeeds |
| migrations | the backup's applied migrations are the repo's journal, in order (newer ones in the repo are fine: deployed after the backup) |
| rls | every `public` table has RLS on, and policies wherever `os_app` has access |
| rows | `auth.user` isn't empty, and no table with ≥ 20 rows (nor the total) fell below half of the last good drill |
| migrate | the repo's newer migrations apply on top |
| test-db | `pnpm test:db` (the RLS suite) passes against the restored copy |

The result lands in **Ops → Server → Restore drill** ("1 Dec, OK, 2 min 14 s,
1,234 rows", with the run log), and osbot alerts (kind **Restore drill**) when
a drill fails or none has passed for 35 days. Production is never touched:
the runner's Postgres is a container of its own, the app only hands out a
15-minute read link to one encrypted file, and the drill's only write is its
report.

**Where the keys live.** The backups' private key stays offline with you, as
before. The drill has its **own** age key: its public half is a second
recipient of every backup (`BACKUP_AGE_RECIPIENT` takes several), its private
half is a GitHub secret. Remove it from `BACKUP_AGE_RECIPIENT` to revoke it
(backups made after that can't be read with it). GitHub never holds a storage
key: web signs the download link with its own S3 key. The repository is
public, so the run log shows only check names and results; the details go to
the app.

**Set it up once:**

1. On your laptop: `age-keygen -o anwar-os-drill.key` (prints `Public key: age1…`).
2. On the server, `infra/.env`: append that public key to
   `BACKUP_AGE_RECIPIENT` (space-separated, after yours), and add
   `RESTORE_DRILL_SECRET=` the output of `openssl rand -hex 32`. Then
   `deploy.sh <current sha>` so web picks the secret up (the backup timer reads
   `.env` on every run).
3. GitHub → the repository → **Settings → Secrets and variables → Actions**:
   secrets `DRILL_AGE_IDENTITY` = the whole content of `anwar-os-drill.key`,
   `RESTORE_DRILL_SECRET` = the same value as on the server; variable
   `PUBLIC_URL` = `https://anwar-os.com` (already there for the deploy).
   Then delete the key file from the laptop (`shred -u anwar-os-drill.key`;
   the password manager can keep a copy).
4. Wait for the next nightly backup (03:15): older backups weren't encrypted to
   the drill key. Then **Actions → Restore drill → Run workflow** once and
   look at Ops → Server.

Without the secrets the workflow says what is missing and does nothing. If
backups don't go to object storage (`BACKUP_TARGET=sftp`) the app can't hand
out a link; run the drill from a laptop with a downloaded file instead.

**By hand** (anywhere with Docker, age, jq, curl and python3; nothing is reported):

```sh
infra/backup/drill.sh --file b.dump.age -i ~/anwar-os-backup.key --migrate   # a downloaded backup
infra/backup/drill.sh --self-test     # builds a fake backup from the repo's migrations and drills it
```

### Manual restore drill on the server

The old by-hand drill still works. It restores into a scratch database next to
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

The expense bot (@anwarexpensesbot, `bots/expenses/README.md`) is a Telegram front-end
for **Budget**: every expense it saves is an ordinary Budget transaction in the default
account, and its summaries, history and CSV read Budget. It has no database access while
running: it calls web's internal API (`/api/internal/budget-bot/*`, HMAC-signed with its
own secret, never reachable through Caddy) over the stack's internal network, as the site
owner. It only serves the owner's Telegram account.

### Set up

1. In `infra/.env` on the server:
   ```sh
   BOT_EXPENSES_TOKEN=<token from @BotFather>        # unchanged if the bot already runs
   BOT_EXPENSES_API_SECRET=$(openssl rand -hex 32)    # paste the value, not the command
   BOT_EXPENSES_OWNER_ID=<your Telegram user id>      # optional when OSBOT_OWNER_CHAT_ID is set
   COMPOSE_PROFILES=bots                              # (,ops if the control panel runs)
   ```
   Only one process may poll a token: stop any older copy of the bot first.
2. `./deploy.sh <current sha>`. web comes first (migration 0027/0028: the
   `budget_transactions.import_key` column, `budget_bot_heartbeats`, and the Bots
   registry entry switching to the `budget-bot` heartbeat) and restarts with
   `BOT_EXPENSES_API_SECRET` (the Budget API is off without it). Then deploy.sh
   starts `bot-expenses` and waits for its healthcheck, which turns healthy only after web
   accepted its first signed heartbeat. With the token set but the secret or owner id
   missing, deploy.sh skips the bot and the previous container keeps running unchanged.
3. Check: send `250 food test` to the bot, see it in **Budget**, delete it with Undo.
   **Bots** shows the expense bot alive with its version.

A bot that fails its healthcheck is rolled back to its previous tag; web stays on the new
release.

Rotating the secret: change `BOT_EXPENSES_API_SECRET`, `deploy.sh <current sha>` (web and
bot restart together). It is separate from `OSBOT_API_SECRET`: neither bot can call the
other's API.

**The old database.** Before it became a Budget front-end the bot wrote to its own schema
`bot_expenses` with its own login role. Its rows were copied into Budget once (each
carries `budget_transactions.import_key` = `bot-expenses:<id>`), and migration 0053
dropped the schema and the role. `BOT_EXPENSES_DB_PASSWORD` in an older `.env` is unused
and can be deleted.

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

Feedback and contact-form alerts: while osbot's heartbeat is fresh (under 3
minutes) it sends them; otherwise web sends them itself through the Bot API with
the same token, so alerts keep working while the bot is down. Each alert is sent
once either way (feedback: `osbot_feedback_alerts`; contact:
`contact_messages.alerted_at`). Contact cards carry ✓ Replied and 🗄 Archive.

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

**Server section.** Below the services, `/app/ops` shows the host: disk (root
filesystem), memory + swap + memory stalls, load, uptime, kernel, a pending
reboot with the packages that asked for it, Docker's disk usage, the last
backup, and the TLS certificate expiry of every domain in `/opt/edge/sites`.
It comes from the agent's `GET /host` (services/ops-agent/README.md); the
agent reads it through read-only mounts set in `compose.prod.yml`: the host's
`/run` (non-recursive, for `/run/reboot-required`), `BACKUP_STATUS_DIR` and
`/opt/edge/sites`. Certificates are checked by web (the agent has no route
out): it dials each domain on 443 with SNI, cached for an hour. A section that
can't be read says why ("not mounted") instead of breaking the page.

First deploy with it: `deploy.sh <sha>` recreates ops-agent with the mounts
(Docker Engine ≥ 25 for the non-recursive mount: `docker version`). The backup
tile shows "Backup status unknown" until `backup.sh` has run once with the new
script; run it right away instead of waiting for the night:

```sh
sudo systemctl start anwar-os-backup.service
ls -l /var/backups/anwar-os-status/      # last.json, last-success.json (-rw-r--r--)
```

The deploy dialog lists tags from GHCR (anonymous for public packages) and
matches sha tags to commits of `GITHUB_REPO` for the message and date. Set
`GITHUB_TOKEN` (read:packages) if the packages are private; then also set
`OPS_AGENT_REGISTRY_USER` / `OPS_AGENT_REGISTRY_TOKEN` so the agent can pull.

## 16. Day-2 notes

- Logs: `dc logs -f web`, `edge logs --tail 200 caddy`. Docker rotates them
  (10 MB × 5 per container).
- `dc ps` shows health; `/api/health` is public for uptime monitors (§19).
- **Ops → Server** shows disk, memory, a pending reboot, the last backup and
  certificate expiry; osbot sends Telegram alerts for them (§19).
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

## 19. Monitoring and alerts

Three layers, each covering what the one before can't see:

| Layer | Runs | Catches | Tells you |
|---|---|---|---|
| **Server alerts** | osbot, every 5 min, on the server | disk, memory, backups, certificates, containers, pending reboot, ops-agent, the weekly files storage check, the monthly restore drill, and new errors in the error log | Telegram (osbot), once on trouble and once on recovery |
| **Uptime** | GitHub Actions, every 10 min (`.github/workflows/uptime.yml`) | the whole server or a site down (from outside) | Telegram, once down and once back |
| **Backup dead-man's switch** | healthchecks.io (optional) | the nightly backup silently not running at all | e-mail / its integrations |

### Server alerts (osbot)

osbot calls `POST /api/internal/osbot/ops-alerts/check` every 5 minutes; web
reads ops-agent's `GET /host`, the service list and the certificates, applies
the rules below (`src/modules/ops/lib/server.ts`, the same ones that colour
Ops → Server) and keeps what you were told in `ops_alert_state`. Each problem is
sent once with its details and an **Open Ops** button, and once more when it
is resolved; bot restarts and deploys repeat nothing (osbot acks each message
after sending it).

| Kind | Fires when |
|---|---|
| Disk | root filesystem more than 85 % used |
| Memory | under 10 % of RAM available, or tasks stalled on memory ≥ 10 % of the last minute (PSI), or swap ≥ 90 % full |
| Backups | the last run failed, the last good one is older than 26 h, no status yet, or the status can't be read |
| Certificates | a site's certificate expires in under 14 days, has expired or isn't trusted (Caddy renews 30 days ahead, so this means renewal is failing) |
| Services | a managed container is down (crashed, OOM-killed), unhealthy or restarting; stopped on purpose doesn't count |
| Reboot | `/run/reboot-required` older than 2 days (unattended-upgrades should have rebooted at 04:30) |
| Agent | ops-agent configured but not answering (everything else is paused then) |
| Files storage | the weekly files storage check (below) found lost, wrong-size or orphaned files, failed, or hasn't run for 9 days |
| Restore drill | the last monthly restore drill (§11) failed, or none passed for 35 days (nothing before the first one passes) |
| Errors | a new error in the error log (below), or a resolved one that came back: one message each, with **Open** and **✓ Resolve** |

If web itself doesn't answer two checks in a row (10 min), osbot says
"anwar.os isn't answering" on its own and "answers again" when it's back.

**Silencing:** Ops → Server → **Telegram alerts**: switch a kind off (it is not
tracked at all until switched back on, then a problem still there is announced;
errors that came in meanwhile aren't replayed),
or **Mute all** for 1, 8 or 24 h (held, not dropped: whatever is still wrong
when the mute ends is sent then). Nothing to configure on the server beyond
osbot (§14) and ops-agent (§15).

### Error log (Ops → Errors)

Server-side errors are kept in Postgres, so you hear about a broken page
without reading container logs:

- **What is caught:** everything Next catches while serving a request
  (`onRequestError` in `src/instrumentation.ts`: Server Component renders,
  route handlers, server actions, the proxy), unhandled rejections and
  exceptions outside a request, failures the internal APIs answer with a 500,
  and the bots' own unhandled exceptions (osbot and the expense bot send them
  to `POST /api/internal/{osbot,budget-bot}/errors/report`; at most 10 a minute
  each, the same one once a minute).
- **What is kept:** the error's name, its message and a short stack (12
  frames), with anything that looks like a secret, token, password, query
  string or email address replaced; the route pattern (`/app/notes/[id]`,
  never the query string), method, where in Next it happened and the digest
  shown on the error page. Never request bodies, headers, cookies or the
  environment.
- **Grouping:** one row per cause: the fingerprint is the source, the name,
  the message with ids, numbers and quoted values replaced, and the top frame
  of our own code without line numbers or build hashes, so a bug stays one
  group across requests and deploys. Each group counts occurrences and keeps
  a 24-hour histogram (the sparkline).
- **Resolve** in one tap (Undo in the toast, or ✓ Resolve in Telegram). A
  resolved error that happens again reopens ("came back") and is announced
  again. The Ops card's badge counts unresolved groups.
- **Telegram:** at most 4 messages an hour; when more errors are waiting, the
  4th is a summary of the rest, and anything past that waits for the next hour.
- **Limits:** the only write path is `app.record_error()` (security definer):
  120 occurrences a minute in total (the rest are dropped, so a storm can't
  fill the disk), at most 1000 groups (resolved and long-quiet ones go first),
  and groups unseen for 90 days are deleted.

### Files storage check (weekly)

The nightly backup dumps Postgres only; uploaded files live in the bucket and
nothing else. Once a week the app checks that the two still agree, so a lost
file is noticed while there is still a copy somewhere to restore it from.

- **When:** osbot calls `POST /api/internal/osbot/files-check/run` every
  Monday from 04:00 (`OSBOT_TIMEZONE`), with `maxAgeHours: 20` so a retry or a
  restart doesn't list the bucket twice. **Ops → Server → Files storage →
  Check now** runs it by hand (3 per 10 minutes).
- **What:** web reads every account's `files_files` rows
  (`app.files_storage_inventory()`, site owner only), lists the bucket
  (ListObjectsV2, 1000 per page), reads the rows again, and compares
  (`src/modules/ops/lib/files-check.ts`):

  | Finding | Means | What to do |
  |---|---|---|
  | **Missing** | a row whose object is gone (confirmed with a HEAD) | restore the object from a copy, or delete the file in Files |
  | **Wrong size** | the object's size differs from the row's | same |
  | **Orphaned** | an object no row points at, older than 24 h: an abandoned upload or a delete that didn't reach storage | **Delete orphans** in the tile |
  | Uploading | the same, younger than 24 h | nothing: an upload in flight |

  The backups' prefix (`BACKUP_PREFIX/`, `postgres/` by default) is counted
  apart and never touched. Other prefixes that aren't Files uploads go in
  `FILES_CHECK_IGNORE_PREFIXES=postgres/,exports/` in `infra/.env` (it replaces
  the default), then `dc up -d web`.
- **Telling you (quiet by design):** the result is stored (`ops_files_check`)
  and the 5-minute server alerts read it as the kind **Files storage**: lost
  or damaged files (`files:missing`), leftovers (`files:orphans`), and a failed
  or stale run (`files:check`, no run for 9 days) each come once, and once more
  when resolved. A clean week sends nothing; the tile shows the last run.
  Switch the kind off in Telegram alerts like any other.
- **Delete orphans** deletes only objects that, checked again at the click,
  have the shape of a Files key (`<owner>/<uuid>`), still have no row, still
  exist and are older than 24 h; then the check runs again. Other unknown keys
  are listed for you to remove by hand. Nothing is ever deleted on its own.

The check needs the S3 key to be allowed to list the bucket (`ListBucket`). A
key without it makes the run fail ("Access Denied (HTTP 403)"), which is
reported as `files:check`.

### Uptime from outside (GitHub Actions)

`.github/workflows/uptime.yml` checks, every 10 minutes with 3 tries 20 s
apart:

| Target | Expect |
|---|---|
| `https://anwar-os.com/api/health` | 200 (web up and Postgres answering) |
| `https://shiftella.app/` | 200 |
| `https://dev.shiftella.app/` | 401 (up, behind basic auth) |

It messages Telegram only on a change (state in the Actions cache), and runs
without messages until the secrets exist. **To turn the messages on** (once):

1. GitHub → the repository → **Settings → Secrets and variables → Actions →
   New repository secret**:
   - `UPTIME_TELEGRAM_TOKEN` = osbot's token (`OSBOT_TOKEN` from `infra/.env`;
     sending through the Bot API doesn't disturb the bot's polling), or any
     other bot's token you've started a chat with;
   - `UPTIME_TELEGRAM_CHAT_ID` = your chat id (`OSBOT_OWNER_CHAT_ID`).
2. **Actions → Uptime → Run workflow** once: the run's summary lists every
   target; with everything up nothing is sent.

Optional: a repository **variable** `UPTIME_TARGETS` replaces the list (one
`name|url|expected status` per line). GitHub may start scheduled runs a few
minutes late, and pauses schedules in a public repository after 60 days
without commits (a push or a manual run re-enables them).

### Backup dead-man's switch (healthchecks.io, optional)

The server alerts notice a stale backup only while the server and osbot run.
healthchecks.io notices a backup that stopped even when everything is down:

1. Sign up at healthchecks.io (free plan), **Add Check**: name `anwar-os
   backup`, schedule **Cron** `15 3 * * *`, time zone `Europe/Prague`, grace
   time **2 hours** (the timer adds up to 15 min of jitter; a backup takes a
   minute or two).
2. Copy the ping URL (`https://hc-ping.com/<uuid>`) into `infra/.env`:
   `BACKUP_PING_URL=https://hc-ping.com/<uuid>`. `backup.sh` pings it on
   success and `<url>/fail` on failure, so a failure alerts at once.
3. `sudo systemctl start anwar-os-backup.service`; the check turns green.
4. In healthchecks.io → Integrations, add e-mail (default) and, if you like,
   Telegram.

## 20. AI assistant (Claude)

One Anthropic API key on **web** switches on two features:

- **Assistant** (`/app/assistant`, also in ⌘K and More): a chat that reads your tasks,
  calendar, budget, notes, inbox, files… through the modules' own actions, as you (RLS).
  Anything that would change data (create/complete/reschedule a task, add an event or an
  expense, delete…) shows a confirm card first; nothing runs until you tap it. Chats are
  stored in Postgres (`assistant_*` tables, private to you); delete them from History.
- **Receipt photos**: Budget quick add → 📷, and sending a photo to the expense bot. Claude
  reads total, shop, date and a category; you check the card, then save. The photo is
  read once and never stored. The bot never sees the key: it sends the photo to web.

Without the key both are off and say "Add ANTHROPIC_API_KEY on the server".

### Switch it on

1. In the [Anthropic Console](https://console.anthropic.com): **Settings → Billing**, add
   credit (and optionally a monthly spend limit there too); then **API keys → Create key**,
   name it `anwar-os`. Copy it (`sk-ant-…`), it is shown once.
2. On the server:
   ```sh
   nano /opt/anwar-os/repo/infra/.env
   # ANTHROPIC_API_KEY=sk-ant-...
   # optional: ASSISTANT_MONTHLY_LIMIT_USD=10   (the app stops new chat turns at this estimate)
   dc up -d web            # recreate web with the new environment (no new image needed)
   ```
   Or simply `./deploy.sh <current sha>`. Only `web` gets these variables
   (`infra/compose.prod.yml`); web needs outbound HTTPS to `api.anthropic.com` (it has it).
3. Check: open **Assistant**, ask "What's on today?". Tool chips ("Searched tasks · 3
   found") show what it looked up. Ask "Add a task: test the assistant" → a confirm card →
   Confirm → the task appears in Tasks. **Settings → AI assistant** shows the models and
   this month's requests, tokens and estimated cost.
4. Receipts: Budget → 📷 next to Add, or send a receipt photo to the expense bot.

### Models and cost

| Use | Default | Override |
|---|---|---|
| Chat with tools | `claude-sonnet-5-5` (fast, strong tool use; $2 / $10 per M tokens) | `ASSISTANT_MODEL` (e.g. `claude-opus-5-5` for harder questions) |
| Receipt photos | `claude-haiku-5-5` (vision, cheapest; well under a cent per receipt) | `RECEIPT_MODEL=claude-sonnet-5-5` if it misreads receipts |

- Chat runs at low thinking effort (`ASSISTANT_EFFORT`, default `low`), replies are capped
  at `ASSISTANT_MAX_TOKENS` (default 8192), and the system prompt + tool list are cached
  (prompt caching), so follow-up turns mostly pay cache-read prices. A typical turn costs
  around a cent; the Settings line estimates from list prices (the Console has the real bill).
- Limits per user: 30 chat messages per 10 minutes and 300 per day; 60 receipt photos per
  hour. Optional hard stop: `ASSISTANT_MONTHLY_LIMIT_USD`.
- Server-side fallback is on (`server-side-fallback-2026-07-01`, `fallbacks: "default"`):
  if a model declines for policy reasons, the API may retry on another model.

Rotating the key: create a new one, replace it in `.env`, `dc up -d web`, then delete the
old key in the Console. Turning AI off: empty `ANTHROPIC_API_KEY`, `dc up -d web`; stored
chats stay and come back when the key does.

New tables (migration from `db/modules/assistant.sql` + the generated table migration):
`assistant_conversations`, `assistant_messages` (append-only), `assistant_usage` (token log).
