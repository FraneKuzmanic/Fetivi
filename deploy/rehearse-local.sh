#!/usr/bin/env bash
# The whole deployment, rehearsed on this machine (RUNBOOK.md, "Rehearsal record"): MinIO stands in
# for the off-site bucket and fetivi.localhost for the domain, with Caddy's internal CA.
#   deploy -> seed a smoke unit -> full smoke check -> scratch restore rehearsal
#   -> in-place point-in-time restore -> smoke check again
# Local only: it refuses a deploy/.env whose DOMAIN is not *.localhost. KEEP=1 leaves the stack up.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
export FETIVI_OVERLAY="$DEPLOY_DIR/docker-compose.rehearsal.yml"

ENV_FILES=(common chat-backend backoffice-api mcp-servers jobs postgres backup)
started_all=$SECONDS

if [[ -f "$DEPLOY_DIR/.env" ]]; then
  domain="$(sed -n 's/^DOMAIN=//p' "$DEPLOY_DIR/.env")"
  [[ "$domain" == *.localhost ]] || die "deploy/.env has DOMAIN=$domain; this rehearsal is local only"
fi

present=0
for f in .env "${ENV_FILES[@]/%/.env}"; do
  [[ "$f" == .env ]] && path="$DEPLOY_DIR/.env" || path="$DEPLOY_DIR/env/$f"
  [[ -f "$path" ]] && present=$((present + 1))
done
if ((present == 0)); then
  log "writing throwaway local env files"
  hex() { openssl rand -hex 32; }
  pg_password="$(hex)" link_secret="$(hex)"
  signing_key="$(openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 | awk '{printf "%s\\n",$0}')"
  mkdir -p "$DEPLOY_DIR/env"
  cat >"$DEPLOY_DIR/.env" <<EOF
DOMAIN=fetivi.localhost
ACME_EMAIL=ops@fetivi.localhost
SMOKE_UNIT_SLUG=
SMOKE_PIN=
EOF
  cat >"$DEPLOY_DIR/env/common.env" <<EOF
NODE_ENV=production
DATABASE_URL=postgres://fetivi:$pg_password@postgres:5432/fetivi
WEATHER_USER_AGENT=Fetivi/0.1 (+mailto:ops@fetivi.localhost)
ANTHROPIC_API_KEY=
EOF
  cat >"$DEPLOY_DIR/env/chat-backend.env" <<EOF
GUEST_TOKEN_PRIVATE_KEY=$signing_key
GUEST_LINK_SECRET=$link_secret
VAPID_PUBLIC_KEY=
FERRYHOPPER_MCP_URL=https://mcp.ferryhopper.com/mcp
EOF
  # Nothing is mailed or charged during the rehearsal; the keys only satisfy production config.
  cat >"$DEPLOY_DIR/env/backoffice-api.env" <<EOF
MAIL_TRANSPORT=resend
RESEND_API_KEY=re_local_rehearsal_unused
MAIL_FROM=Fetivi <notifications@fetivi.localhost>
RESEND_WEBHOOK_SECRET=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
VAPID_PUBLIC_KEY=
EOF
  cat >"$DEPLOY_DIR/env/mcp-servers.env" <<EOF
REQUEST_STATE_SECRET=$(hex)
BRAVE_SEARCH_API_KEY=
EOF
  cat >"$DEPLOY_DIR/env/jobs.env" <<EOF
PROVIDER_LINK_SECRET=$(hex)
GUEST_LINK_SECRET=$link_secret
MAIL_TRANSPORT=resend
RESEND_API_KEY=re_local_rehearsal_unused
MAIL_FROM=Fetivi <notifications@fetivi.localhost>
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:ops@fetivi.localhost
STRIPE_SECRET_KEY=
JADROLINIJA_RSS_ENABLED=false
EOF
  cat >"$DEPLOY_DIR/env/postgres.env" <<EOF
POSTGRES_USER=fetivi
POSTGRES_PASSWORD=$pg_password
POSTGRES_DB=fetivi
PGUSER=fetivi
PGPASSWORD=$pg_password
PGDATABASE=fetivi
EOF
  # The overlay's MinIO root credentials (docker-compose.rehearsal.yml defaults).
  cat >"$DEPLOY_DIR/env/backup.env" <<EOF
WALG_S3_PREFIX=s3://fetivi-backups/wal-g
AWS_ACCESS_KEY_ID=${MINIO_ROOT_USER:-rehearsal}
AWS_SECRET_ACCESS_KEY=${MINIO_ROOT_PASSWORD:-rehearsal-secret}
AWS_ENDPOINT=http://minio:9000
AWS_REGION=us-east-1
AWS_S3_FORCE_PATH_STYLE=true
WALG_LIBSODIUM_KEY=$(hex)
WALG_LIBSODIUM_KEY_TRANSFORM=hex
RESTIC_REPOSITORY=s3:http://minio:9000/fetivi-backups/restic-media
RESTIC_PASSWORD=$(hex)
EOF
elif ((present < ${#ENV_FILES[@]} + 1)); then
  die "some local env files are missing; reset with: docker compose -p $PROJECT down -v, then delete deploy/.env and deploy/env/*.env"
fi

log "deploy"
bash "$DEPLOY_DIR/deploy.sh"

log "seeding a throwaway smoke unit"
seed="$(compose run --rm -T -e ALLOW_SMOKE_SEED=1 tools -c \
  "cd packages/domain && node --import tsx src/testing/smoke-seed-cli.ts" 2>/dev/null | grep '^SMOKE_' | tr -d '\r')"
slug="$(sed -n 's/^SMOKE_UNIT_SLUG=//p' <<<"$seed")"
pin="$(sed -n 's/^SMOKE_PIN=//p' <<<"$seed")"
[[ -n "$slug" && -n "$pin" ]] || die "smoke:seed printed no unit"
sed -i -e "s/^SMOKE_UNIT_SLUG=.*/SMOKE_UNIT_SLUG=$slug/" -e "s/^SMOKE_PIN=.*/SMOKE_PIN=$pin/" "$DEPLOY_DIR/.env"
echo "smoke unit $slug"

log "full smoke check"
smoke_log="$(mktemp)"
compose run --rm -T tools deploy/smoke.sh | tee "$smoke_log"
if grep -q SKIPPED "$smoke_log"; then die "the smoke check skipped steps"; fi
rm -f "$smoke_log"

log "scratch restore rehearsal"
bash "$DEPLOY_DIR/rehearse-restore.sh"

log "in-place point-in-time restore"
psql_prod -c 'create table if not exists inplace_rehearsal (label text not null)' >/dev/null
psql_prod -c "insert into inplace_rehearsal values ('C')" >/dev/null
sleep 2
target="$(psql_prod -c "select to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'")"
sleep 2
psql_prod -c "insert into inplace_rehearsal values ('D')" >/dev/null
wal_switch_and_wait
started=$SECONDS
RESTORE_CONFIRM=yes bash "$DEPLOY_DIR/restore.sh" --target-time "$target" --media
inplace_seconds=$((SECONDS - started))
labels="$(psql_prod -c "select coalesce(string_agg(label, ',' order by label), '') from inplace_rehearsal")"
[[ "$labels" == "C" ]] || die "in-place restore: expected only C, found '$labels'"
echo "PASS  in-place restore to $target: C present, D absent (${inplace_seconds} s incl. fresh base backup)"
psql_prod -c 'drop table inplace_rehearsal' >/dev/null
compose exec -T postgres sh -c 'rm -rf /var/lib/postgresql/data/pgdata.before-restore-*'

log "smoke check after the restore"
compose run --rm -T tools deploy/smoke.sh

log "versions"
compose exec -T backup sh -c 'wal-g --version | head -1; restic version'
compose exec -T caddy caddy version
echo "rehearsal took $((SECONDS - started_all)) s in all"

if [[ "${KEEP:-}" == 1 ]]; then
  echo "stack left running (KEEP=1). Reset everything: docker compose -p $PROJECT down -v, then delete deploy/.env and deploy/env/*.env"
else
  log "stopping the stack (volumes kept)"
  compose --profile tools down
  echo "reset everything: docker compose -p $PROJECT down -v, then delete deploy/.env and deploy/env/*.env"
fi
log "local rehearsal passed"
