# 0023: Backups are WAL-G and restic to one S3-compatible bucket

**Status:** accepted, 2026-10-24 (ticket 47)

## Context

Architecture §4.3 requires point-in-time recovery with continuous WAL archiving off-site, rehearsed before real payments are taken. Nightly dumps alone are not enough. ADR 0003 puts Guide media on a local volume that must be in the backups. The deployment is host-agnostic Docker Compose on any Linux VPS (ticket 47), so the backups may not depend on a provider's snapshots or SDKs. No bucket existed when this was built, so everything had to be verifiable against a local stand-in.

## Decision

- **Database: WAL-G.** `archive_command = wal-g wal-push %p` with `archive_timeout=60`, plus a full base backup every day from a `backup` sidecar (same image, same uid, same PGDATA path), keeping 7. RPO is about 1 minute and the PITR window is 7 days.
- **Media: restic.** A daily snapshot of the `media` volume from the same sidecar, keeping 7 daily snapshots. RPO is 24 hours.
- **One S3-compatible bucket, configured only by environment** (`deploy/env/backup.env`): `WALG_S3_PREFIX`, `AWS_*` and `RESTIC_REPOSITORY`, with one key pair for both tools. Cloudflare R2 is recommended (a different provider from the VPS, no egress fees on restore). MinIO stands in for it locally.
- **Client-side encryption is mandatory**: `WALG_LIBSODIUM_KEY` and `RESTIC_PASSWORD`, kept in the password manager as well as on the server.
- **Restores go through `deploy/restore.sh`**, which picks the newest base backup that finished before the target. `--scratch` restores into a throwaway container with `archive_mode=off`. That makes `deploy/rehearse-restore.sh` safe to run on production.

## Rejected

- pgBackRest: a config file and stanza management, where WAL-G is one binary configured entirely by env.
- Nightly `pg_dump`: no point-in-time recovery, which §4.3 rules out.
- VPS provider snapshots or a managed database: provider-specific, and snapshots are not point-in-time.
- Separate tools or buckets for media: one bucket and one key pair is less for one operator to manage.

## Consequences

- Losing the two encryption keys makes every backup unreadable, so they must live off the server too.
- While `archive_command` fails, Postgres keeps WAL on disk and the disk fills. `deploy.sh` checks the archiver and the base-backup age; the runbook has a daily check. There is no alerting yet.
- An in-place restore starts a new timeline and takes a fresh base backup straight away. Stripe payments after the restore point are found by the reconciliation job (§4.3).
- The WAL-G and restic binaries are amd64 downloads pinned by sha256; an arm64 server needs other assets.
