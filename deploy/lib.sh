#!/usr/bin/env bash
# Shared helpers, sourced by every deploy script. FETIVI_OVERLAY adds a second compose file
# (rehearse-local.sh sets it to the local MinIO/CA overlay).

# pwd -W exists only in Git Bash: the C:/... form, which docker and git understand without the
# path conversion switched off below.
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && { pwd -W 2>/dev/null || pwd; })"
# The Compose project (docker-compose.prod.yml `name:`): volumes and the network carry it as prefix.
PROJECT=fetivi-prod
PG_IMAGE="fetivi-postgres:${FETIVI_TAG:-latest}"
# Git Bash on Windows would rewrite container paths like /restore in docker arguments.
export MSYS_NO_PATHCONV=1

compose() {
  docker compose -f "$DEPLOY_DIR/docker-compose.prod.yml" ${FETIVI_OVERLAY:+-f "$FETIVI_OVERLAY"} \
    --env-file "$DEPLOY_DIR/.env" "$@"
}

# psql in the running postgres container, as the owner role from its own env. Extra args go to
# psql (e.g. -c "select 1").
psql_prod() {
  compose exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA "$@"' psql "$@"
}

# Closes the current WAL segment and waits until the archiver has pushed it (up to 90 s). Dies when
# archive_command fails meanwhile: WAL would then pile up on the server's disk.
wal_switch_and_wait() {
  local failed_before wal last failed
  failed_before="$(psql_prod -c 'select failed_count from pg_stat_archiver')"
  wal="$(psql_prod -c 'select pg_walfile_name(pg_switch_wal())')"
  for _ in $(seq 1 45); do
    IFS='|' read -r last failed <<<"$(psql_prod -c "select coalesce(last_archived_wal, ''), failed_count from pg_stat_archiver")"
    if ((failed > failed_before)); then
      die "archive_command failed (pg_stat_archiver.failed_count $failed_before -> $failed); check deploy/env/backup.env"
    fi
    if [[ "$last" > "$wal" || "$last" == "$wal" ]]; then
      echo "WAL archived up to $last"
      return 0
    fi
    sleep 2
  done
  die "WAL $wal was not archived within 90 s"
}

log() { printf '\n==> %s\n' "$*"; }

die() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}
