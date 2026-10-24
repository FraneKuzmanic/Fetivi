#!/usr/bin/env bash
# One-command deploy on the server: build the images, migrate, restart, check the backups, smoke
# check. Stops at the first failed step; there is no automatic rollback (RUNBOOK.md, "Rollback").
#   bash deploy/deploy.sh
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

log "preflight"
[[ -f "$DEPLOY_DIR/.env" ]] || die "missing deploy/.env (copy deploy/.env.example and fill it in)"
for name in "${ENV_FILES[@]}"; do
  [[ -f "$DEPLOY_DIR/env/$name.env" ]] ||
    die "missing deploy/env/$name.env (copy deploy/env/$name.env.example and fill it in)"
done
if left="$(grep -l 'change-me' "$DEPLOY_DIR/.env" "$DEPLOY_DIR"/env/*.env)"; then
  die "placeholder 'change-me' left in: $(echo "$left" | tr '\n' ' ')"
fi
grep -Eq '^ACME_EMAIL=.+' "$DEPLOY_DIR/.env" || die "ACME_EMAIL is empty in deploy/.env (Caddy needs it)"
docker compose version >/dev/null || die "docker compose is not available"
sha="$(git -C "$DEPLOY_DIR" rev-parse --short HEAD 2>/dev/null || echo unknown)"
echo "commit $sha"
if [[ -n "$(git -C "$DEPLOY_DIR" status --porcelain 2>/dev/null)" ]]; then
  echo "WARNING: the checkout has uncommitted changes; they are deployed too"
fi

log "building images"
compose build

log "starting postgres"
compose up -d --wait postgres

log "migrating"
compose run --rm -T migrate

log "starting every service"
compose up -d --wait --remove-orphans

log "base backup"
if ! compose exec -T backup sh -c 'wal-g backup-list --json 2>/dev/null | jq -e "length > 0"' >/dev/null; then
  echo "no base backup yet, taking the first one"
  compose exec -T backup backup-now.sh
else
  echo "a base backup exists"
fi

log "checking WAL archiving"
wal_switch_and_wait

log "checking base backup age"
age="$(compose exec -T backup sh -c \
  'wal-g backup-list --json --detail 2>/dev/null | jq -r "map(.finish_time) | max | sub(\"\\\\.[0-9]+\"; \"\") | fromdateiso8601 | now - . | floor"')"
((age < 26 * 3600)) || die "the newest base backup is $((age / 3600)) h old (more than 26 h)"
echo "newest base backup is $((age / 60)) min old"

log "smoke check"
compose run --rm -T tools deploy/smoke.sh

log "deployed $sha"
