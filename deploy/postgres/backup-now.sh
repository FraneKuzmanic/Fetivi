#!/usr/bin/env bash
# One backup round: a full base backup of the database, a snapshot of the media volume, and
# retention for both (7 of each). Runs as postgres in the backup sidecar, which shares the
# pgdata volume at the server's PGDATA path and mounts media read-only at /media.
set -euo pipefail

echo "==> base backup of $PGDATA"
wal-g backup-push "$PGDATA"

echo "==> keeping the 7 newest base backups"
wal-g delete retain FULL 7 --confirm

echo "==> media snapshot"
restic cat config >/dev/null 2>&1 || restic init
restic backup /media --tag media
restic forget --tag media --keep-daily 7 --prune

echo "==> backup done at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
