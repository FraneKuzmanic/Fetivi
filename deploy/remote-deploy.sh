#!/usr/bin/env bash
# Run on the server by the CI deploy key (a forced command in ~/.ssh/authorized_keys, RUNBOOK.md):
# moves the checkout to origin/main and runs deploy.sh. The full log stays on the server; the
# caller sees only the step lines, because a public repository's Actions log is public.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

exec 9>/tmp/fetivi-deploy.lock
flock -n 9 || { echo "another deploy is running"; exit 1; }

log_dir="$HOME/deploy-logs"
mkdir -p "$log_dir"
log="$log_dir/$(date -u +%Y%m%dT%H%M%SZ).log"

git fetch --quiet origin main
git checkout --quiet -B main origin/main
echo "deploying $(git rev-parse --short HEAD)"

if bash deploy/deploy.sh >"$log" 2>&1; then
  grep -E '^(==> |commit )' "$log"
else
  grep -E '^(==> |ERROR)' "$log"
  echo "deploy failed; full log on the server: $log"
  exit 1
fi
