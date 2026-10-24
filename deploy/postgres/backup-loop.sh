#!/usr/bin/env bash
# The backup sidecar's entrypoint: one round a day. The first round waits 10 minutes so a deploy
# is not slowed; deploy.sh takes the first base backup itself when none exists.
set -uo pipefail

sleep 600
while true; do
  backup-now.sh || echo "backup failed at $(date -u +%Y-%m-%dT%H:%M:%SZ)" >&2
  sleep 86400
done
