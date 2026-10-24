# Fetivi production runbook

One Linux VPS running Docker Compose. Everything here runs from the repo checkout on the server, as a non-root user in the `docker` group. Commands marked **(server only)** could not be run in the local rehearsal (no server, DNS or bucket existed yet). Every other command ran during the rehearsal on 2026-10-24 (section 10).

`compose` below is short for:

```sh
docker compose -f deploy/docker-compose.prod.yml --env-file deploy/.env
```

The scripts call it for you (`deploy/lib.sh`).

## 1. What runs where

```
Internet ──443──► caddy ─┬─ app.<domain>      /api/*, /health, /.well-known/*  ► chat-backend:3000
                         │                    everything else                   ► guest SPA (files in the caddy image)
                         ├─ host.<domain>     /api/*, /webhooks/*, /health      ► backoffice-api:3001
                         │                    everything else                   ► back-office SPA
                         ├─ mcp.<domain>      everything                        ► mcp-servers:3002
                         └─ sandbox.<domain>  everything                        ► sandbox-proxy:5175

jobs (no HTTP)   postgres (+ WAL-G archive_command)   backup (daily sidecar)   jaeger (127.0.0.1:16686)
```

- Inside the Compose network the four public names are aliases of Caddy (fixed IP `172.31.47.10`). The chat backend calls `https://mcp.<domain>` and the MCP servers fetch `https://app.<domain>/.well-known/jwks.json` through Caddy, the same way outside callers do (ADR 0024).
- Volumes: `pgdata` (the database), `media` (Guide media, shared by chat-backend and backoffice-api), `caddy_data` (certificates), `caddy_config`.
- Backed up off-site, to one S3-compatible bucket, encrypted client-side (ADR 0023):
  - Database: WAL archived continuously (`archive_timeout=60`, so at most about **1 minute** of data is lost) plus a full base backup every day, 7 kept. You can restore to any point in the last **7 days**.
  - Media: a restic snapshot every day, 7 kept. At most **24 hours** of media changes are lost.
- Not backed up: `caddy_data` (certificates are reissued), Jaeger (traces are in memory).

## 2. Pick and create the server (server only)

Any amd64 Linux VPS works. Recommended: an Azure VM `Standard_B2s` (2 vCPU, 4 GB), Ubuntu 24.04, paid from the student credits. A Hetzner `CX22` is the equivalent fallback.

1. Create the VM with a 30 GB or larger disk and your SSH key. Allow inbound 22, 80 and 443 only (Azure network security group, or `ufw allow 22,80,443/tcp && ufw allow 443/udp && ufw enable`).
2. Install Docker Engine and the compose plugin (<https://docs.docker.com/engine/install/ubuntu/>).
3. `adduser deploy && usermod -aG docker deploy`, then log in as `deploy`.
4. `git clone <repo> fetivi && cd fetivi`

An arm64 server (e.g. Hetzner CAX) needs the arm64 WAL-G and restic assets: change the two download URLs and their `sha256` args in `deploy/postgres/Dockerfile`. The Node and Caddy base images are multi-arch.

## 3. DNS (server only)

Four records pointing at the server's public IP: `app`, `host`, `mcp`, `sandbox` (A, plus AAAA if the server has IPv6). The apex domain is not used. Caddy gets the Let's Encrypt certificates on first start, once these resolve.

## 4. Off-site bucket (server only)

Recommended: Cloudflare R2. It is S3-compatible, has no egress fees on restore, and is a different provider from the VPS. Backblaze B2 also works.

1. Create one private bucket, e.g. `fetivi-backups`.
2. Create one API token scoped to that bucket with read and write access. Note the access key id, the secret and the S3 endpoint (`https://<account>.r2.cloudflarestorage.com`).

## 5. Secrets (server only)

```sh
cp deploy/.env.example deploy/.env
for f in deploy/env/*.env.example; do cp "$f" "${f%.example}"; done
chmod 600 deploy/.env deploy/env/*.env
```

Fill every `change-me`. `deploy.sh` refuses to run while one is left. The comments in each file say what a value is. Generators:

| Value | Command |
|---|---|
| `GUEST_LINK_SECRET`, `PROVIDER_LINK_SECRET`, `REQUEST_STATE_SECRET`, `WALG_LIBSODIUM_KEY`, `RESTIC_PASSWORD`, the Postgres password | `openssl rand -hex 32` |
| `GUEST_TOKEN_PRIVATE_KEY` (one line, literal `\n`) | `openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 \| awk '{printf "%s\\n",$0}'` |
| VAPID pair (after the first build) | `compose --profile tools run --rm tools -c "packages/domain/node_modules/.bin/web-push generate-vapid-keys"` |

These values must match across files:

- `GUEST_LINK_SECRET`: `chat-backend.env` = `jobs.env`.
- `VAPID_PUBLIC_KEY`: `chat-backend.env` = `backoffice-api.env` = `jobs.env`.
- The Postgres password: `POSTGRES_PASSWORD` = `PGPASSWORD` in `postgres.env`, and the password inside `DATABASE_URL` in `common.env`.
- The bucket: `WALG_S3_PREFIX=s3://<bucket>/wal-g` and `RESTIC_REPOSITORY=s3:<endpoint>/<bucket>/restic-media` in `backup.env`.

Put `WALG_LIBSODIUM_KEY` and `RESTIC_PASSWORD` in the password manager as well. Without them the backups cannot be read, and if the server is lost they are lost with it.

## 6. First deploy

```sh
bash deploy/deploy.sh
```

It runs these steps and stops at the first one that fails:

1. Preflight: the env files exist and no placeholder is left.
2. Build the three images.
3. Start Postgres, then run the migrations.
4. Start every service and wait for the healthchecks.
5. Take the first base backup if none exists yet.
6. Check that WAL archiving works and that the newest base backup is less than 26 h old.
7. Run the smoke check.

Then:

1. Create the admin. The password is printed once, or set it with `-e ADMIN_PASSWORD=…`:
   ```sh
   compose run --rm --no-deps backoffice-api node --import tsx src/cli/create-admin.ts --email you@example.com
   ```
2. Webhooks (server only): in Stripe, add `https://host.<domain>/webhooks/stripe` and put its signing secret in `STRIPE_WEBHOOK_SECRET`. In Resend, add `https://host.<domain>/webhooks/resend` and put its secret in `RESEND_WEBHOOK_SECRET`. Both go in `backoffice-api.env`. Re-run `deploy.sh`.
3. The smoke unit (server only): in the back office, create a unit called e.g. "Smoke check" with a Stay running about a year and its own PIN. Put its link slug and PIN in `deploy/.env` as `SMOKE_UNIT_SLUG` / `SMOKE_PIN`. Until then the smoke check prints `SKIPPED` for the guest PIN flow and the MCP Inspector step. Each smoke run opens one Space on that Stay. Retention deletes them 30 days after the Stay's checkout, so give the Stay a rolling end date.

## 7. Every deploy, and rollback

```sh
git pull && bash deploy/deploy.sh
```

The services restart, so expect a few seconds of downtime. Re-running without changes is safe: the migrations are a no-op and no second base backup is taken.

Rollback (no automation; migrations only go forward):

- **No migration in the bad release:** `git checkout <previous commit> && bash deploy/deploy.sh`.
- **A migration ran:** restore to just before the deploy (section 9), then deploy the previous commit. `deploy.sh` prints the commit it deployed. The deploy time is in `compose logs migrate` or your shell history.

The smoke check on its own:

```sh
compose --profile tools run --rm tools deploy/smoke.sh
```

## 8. Backups

- `postgres` pushes every finished WAL segment with `wal-g wal-push` (`archive_command`), and at least once a minute (`archive_timeout=60`).
- The `backup` sidecar runs `backup-now.sh` 10 minutes after it starts and then every 24 h. Each run takes a base backup, keeps 7, takes a restic snapshot of `media` and keeps 7 daily snapshots.
- Take a backup now: `compose exec backup backup-now.sh`.

Daily check (one minute; there is no alerting yet):

```sh
compose exec backup wal-g backup-list                      # newest base backup < 26 h old
compose exec postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select last_archived_time, failed_count, last_failed_time from pg_stat_archiver"'
compose exec backup restic snapshots --tag media           # newest snapshot < 26 h old
df -h /                                                     # disk
```

If `archive_command` keeps failing (bad keys, bucket down), Postgres keeps every WAL segment on disk until archiving works again. The disk then slowly fills. Fix `backup.env` and restart `postgres` and `backup`. `deploy.sh` also dies when `failed_count` rises during its archive check.

## 9. Restore

All restores go through `deploy/restore.sh`. `--target-time` takes a timestamp **with an offset**, e.g. `"2026-10-24 14:03:00+00"`. Without it, every archived WAL is replayed (the latest state). The script picks the newest base backup that finished before the target. A target older than the oldest kept base backup (7 days) is refused.

**Look first, without touching anything** (a scratch copy in its own container):

```sh
bash deploy/restore.sh --scratch --target-time "2026-10-24 14:03:00+00"
docker exec -it fetivi-restore-db-<id> psql        # inspect
bash deploy/restore.sh --cleanup <id>
```

**Point-in-time restore in place** (e.g. a bad migration or a destructive mistake):

```sh
RESTORE_CONFIRM=yes bash deploy/restore.sh --target-time "2026-10-24 14:03:00+00"
```

1. It closes the current WAL segment and waits until it is archived.
2. It stops Caddy, the apps, the backup sidecar and Postgres.
3. It moves the current cluster to `pgdata.before-restore-<id>` inside the volume.
4. It fetches the base backup and recovers to the target.
5. It starts Postgres, takes a fresh base backup on the new timeline, and starts everything again.

Afterwards:

- Open **Admin → Reconciliation** in the back office. Payments Stripe took after the target are missing from the restored database, and reconciliation is what closes that gap (architecture §4.3).
- Run the smoke check.
- Once you are satisfied, delete the old cluster: `compose exec postgres rm -rf /var/lib/postgresql/data/pgdata.before-restore-<id>`.

**Media**: add `--media` to the in-place restore. It restores the newest restic snapshot over the `media` volume. Files added after that snapshot stay, files deleted after it come back, and retention sweeps orphans (ADR 0003).

**The server is lost** (server only):

1. Create a new server (sections 2 and 3).
2. Clone the repo and restore the env files from the password manager or your copy.
3. `compose build`
4. `RESTORE_CONFIRM=yes bash deploy/restore.sh --media`. With nothing running it restores the latest state into the empty volume.
5. `bash deploy/deploy.sh`

## 10. Rehearsal

Run the restore rehearsal before the first real payment and after any change to the backup setup:

```sh
bash deploy/rehearse-restore.sh
```

It is safe on production. It touches only a scratch table, a scratch media file and a throwaway container.

1. It writes marker A, records a time T, writes marker B, and waits until all of it is archived.
2. It restores to T in scratch mode and checks: A is present, B is absent, the schema is there, and the copy does not archive.
3. It round-trips one media file through restic.
4. It prints PASS or FAIL with the restore time.

The whole local stand-in (MinIO for the bucket, `fetivi.localhost` with Caddy's internal CA) runs with `bash deploy/rehearse-local.sh` from Git Bash or Linux. It writes throwaway env files, deploys, seeds a smoke unit, runs the full smoke check, runs `rehearse-restore.sh`, does one in-place point-in-time restore with `--media`, and runs the smoke check again. `KEEP=1` leaves the stack up. Reset with `docker compose -p fetivi-prod down -v`, then delete `deploy/.env` and `deploy/env/*.env`.

### Rehearsal record

| Date | Where | Versions | Result |
|---|---|---|---|
| 2026-10-24 | Local (Windows 11, Docker 29.4.1, Compose 5.1.3), MinIO `pgsty/minio:RELEASE.2026-08-04T00-00-00Z` | Postgres 16 + PostGIS 3.6, WAL-G v3.0.9, restic 0.18.1, Caddy v2.11.6 | **PASS**, from empty volumes: deploy, 17/17 smoke checks (health ×4, both SPAs, JWKS, MCP 401, sandbox CSP, PIN flow, MCP Inspector `tools/list` on `https://mcp.fetivi.localhost/stay`). Scratch PITR: fetch 5 s, recovery 3 s, A yes / B no, archive off. Media round trip OK. In-place PITR with `--media`: fetch 5 s, recovery 5 s, 29 s including the fresh base backup; C yes / D no; smoke check green afterwards. Whole run 107 s with images cached. Bucket after the run: WAL-G 37 MiB (two base backups, timelines 1 and 2), restic 3 KiB. |
| _to do_ | Production server | | Run `bash deploy/rehearse-restore.sh` and fill in this row. |

Not covered locally: a real chat turn streaming (SSE) through Caddy, because there was no `ANTHROPIC_API_KEY`. Check it once on the server.

## 11. Traces

Jaeger listens on the server's loopback only:

```sh
ssh -L 16686:127.0.0.1:16686 deploy@<server>      # then open http://localhost:16686
```

Traces are kept in memory and are lost when the container restarts (ADR 0022). Turn tracing off with `OTEL_SDK_DISABLED=true` in `common.env`.

## 12. Changing the internal subnet

If `172.31.47.0/24` collides with another Docker or VPN network, change it in `deploy/docker-compose.prod.yml` in three places:

- the `networks.internal` subnet;
- Caddy's `ipv4_address`;
- the `TRUST_PROXY` value of chat-backend and backoffice-api (the Caddy IP).

Then run `compose down` and `bash deploy/deploy.sh`.
