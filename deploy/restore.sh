#!/usr/bin/env bash
# Point-in-time restore of the database from the off-site WAL-G backups (RUNBOOK.md, "Restore").
#
#   restore.sh --scratch [--target-time T]    restore into a throwaway volume and container; the
#                                             live database is not touched (rehearse-restore.sh)
#   RESTORE_CONFIRM=yes restore.sh [--target-time T] [--media]
#                                             restore in place: stops the apps, moves the current
#                                             cluster aside, recovers, takes a fresh base backup
#   restore.sh --cleanup <id>                 remove a scratch restore's container and volume
#
# T is a timestamp with an explicit offset, e.g. "2026-10-24 14:03:00+00"; without it the restore
# replays every archived WAL. RESTORE_ID names the scratch container (default: a timestamp).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

target="" scratch=0 media=0 cleanup=""
while (($# > 0)); do
  case "$1" in
    --target-time) target="${2:?--target-time needs a value}"; shift 2 ;;
    --scratch) scratch=1; shift ;;
    --media) media=1; shift ;;
    --cleanup) cleanup="${2:?--cleanup needs an id}"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

if [[ -n "$cleanup" ]]; then
  log "removing scratch restore $cleanup"
  docker rm -f "fetivi-restore-db-$cleanup" >/dev/null 2>&1 || true
  docker volume rm "fetivi-restore-scratch-$cleanup" >/dev/null 2>&1 || true
  exit 0
fi

id="${RESTORE_ID:-$(date -u +%Y%m%d%H%M%S)}"
target_epoch=""
if [[ -n "$target" ]]; then
  target_epoch="$(date -u -d "$target" +%s 2>/dev/null)" || die "cannot parse --target-time '$target'"
fi
if ((scratch == 0)) && [[ "${RESTORE_CONFIRM:-}" != "yes" ]]; then
  die "an in-place restore replaces the live database; set RESTORE_CONFIRM=yes (or use --scratch)"
fi
((scratch == 1 && media == 1)) && die "--media restores the live media volume; it cannot be combined with --scratch"

log "choosing the base backup${target:+ that finished before $target}"
# A base backup that finished after the target cannot be rolled back to it, so pick by finish time.
name="$(compose run --rm --no-deps -T -e TARGET_EPOCH="$target_epoch" --entrypoint sh backup -c '
  wal-g backup-list --json --detail 2>/dev/null | jq -r "
    map(. + {fin: (.finish_time | sub(\"\\\\.[0-9]+\"; \"\") | fromdateiso8601)})
    | map(select(env.TARGET_EPOCH == \"\" or .fin < (env.TARGET_EPOCH | tonumber)))
    | max_by(.fin) | .backup_name // empty"')"
[[ -n "$name" ]] || die "no base backup finished before ${target:-now}; the point-in-time window starts at the oldest base backup"
echo "base backup: $name"

# Runs as root in a one-off postgres container with PGDATA set; NAME, TARGET and SCRATCH from -e.
# shellcheck disable=SC2016
fetch='set -euo pipefail
wal-g backup-fetch "$PGDATA" "$NAME"
touch "$PGDATA/recovery.signal"
{
  echo "restore_command = '"'"'wal-g wal-fetch %f %p'"'"'"
  if [ -n "$TARGET" ]; then echo "recovery_target_time = '"'"'$TARGET'"'"'"; fi
  echo "recovery_target_action = '"'"'promote'"'"'"
  # A scratch copy must never push its new timeline into the production archive.
  if [ "$SCRATCH" = 1 ]; then echo "archive_mode = '"'"'off'"'"'"; fi
} >>"$PGDATA/postgresql.auto.conf"
chown -R postgres:postgres "$PGDATA"
chmod 700 "$PGDATA"'

# wait_promoted <psql command...>: polls until the server has left recovery (5 min).
wait_promoted() {
  local state
  for _ in $(seq 1 150); do
    state="$("$@" -c 'select pg_is_in_recovery()' 2>/dev/null || true)"
    if [[ "$state" == "f" ]]; then return 0; fi
    sleep 2
  done
  return 1
}

if ((scratch == 1)); then
  vol="fetivi-restore-scratch-$id"
  container="fetivi-restore-db-$id"
  log "fetching into scratch volume $vol"
  docker volume create "$vol" >/dev/null
  started=$SECONDS
  compose run --rm --no-deps -T -v "$vol:/restore" -e PGDATA=/restore/pgdata \
    -e NAME="$name" -e TARGET="$target" -e SCRATCH=1 --entrypoint bash postgres -c "$fetch"
  echo "fetch took $((SECONDS - started)) s"

  log "recovering in $container"
  started=$SECONDS
  docker run -d --name "$container" --network "${PROJECT}_internal" \
    --env-file "$DEPLOY_DIR/env/postgres.env" --env-file "$DEPLOY_DIR/env/backup.env" \
    -e PGDATA=/restore/pgdata -v "$vol:/restore" "$PG_IMAGE" postgres >/dev/null
  scratch_psql() { docker exec "$container" psql -v ON_ERROR_STOP=1 -tA "$@"; }
  if ! wait_promoted scratch_psql; then
    docker logs --tail 30 "$container" >&2 || true
    die "the scratch copy did not finish recovery within 5 min (clean up: restore.sh --cleanup $id)"
  fi
  echo "recovery took $((SECONDS - started)) s"
  log "scratch restore ready"
  echo "inspect: docker exec -it $container psql"
  echo "remove:  bash deploy/restore.sh --cleanup $id"
  echo "SCRATCH_CONTAINER=$container"
  exit 0
fi

log "closing the current WAL segment, so the archive holds everything up to now"
if compose exec -T postgres pg_isready -q 2>/dev/null; then
  wal_switch_and_wait
else
  echo "postgres is not running; the restore uses what the archive already holds"
fi

log "stopping the apps, the backup sidecar and postgres"
compose stop caddy chat-backend backoffice-api mcp-servers jobs sandbox-proxy backup postgres

log "moving the current cluster aside and fetching $name"
started=$SECONDS
compose run --rm --no-deps -T -e NAME="$name" -e TARGET="$target" -e SCRATCH=0 \
  --entrypoint bash postgres -c "if [ -d \"\$PGDATA\" ]; then mv \"\$PGDATA\" \"\$PGDATA.before-restore-$id\"; fi
$fetch"
echo "fetch took $((SECONDS - started)) s"

log "recovering"
started=$SECONDS
compose up -d postgres
if ! wait_promoted psql_prod; then
  compose logs --tail 30 postgres >&2 || true
  die "postgres did not finish recovery within 5 min"
fi
echo "recovery took $((SECONDS - started)) s"
# The recovery settings only matter during recovery; drop them so a later restart is plain.
psql_prod -c 'alter system reset restore_command' -c 'alter system reset recovery_target_time' \
  -c 'alter system reset recovery_target_action' -c 'select pg_reload_conf()' >/dev/null

if ((media == 1)); then
  log "restoring the media volume from the newest snapshot"
  docker run --rm --network "${PROJECT}_internal" --env-file "$DEPLOY_DIR/env/backup.env" \
    -v "${PROJECT}_media:/media" "$PG_IMAGE" restic restore latest --tag media --target /
fi

log "fresh base backup on the new timeline"
compose up -d --wait backup
compose exec -T backup backup-now.sh

log "starting every service"
compose up -d --wait

log "restore done"
echo "The old cluster is kept at PGDATA.before-restore-$id in the pgdata volume; delete it once satisfied:"
echo "  docker compose ... exec postgres rm -rf /var/lib/postgresql/data/pgdata.before-restore-$id"
echo "Payments after ${target:-the restore point} may be missing: check Admin -> Reconciliation (architecture §4.3)."
