#!/usr/bin/env bash
# Restore rehearsal, safe on the production server: it writes only a scratch table and a scratch
# media file, and restores into a throwaway container (restore.sh --scratch).
#   1. marker A, then the target time T, then marker B, all archived
#   2. point-in-time restore to T: A must be there, B must not, the schema must be there, and the
#      copy must not archive (archive_mode is off, and the bucket's newest timeline is unchanged)
#   3. a media file round-trips through restic
# Run it before the first real payment and after any change to the backup setup (RUNBOOK.md).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

id="$(date -u +%Y%m%d%H%M%S)"
media_file="/data/media/rehearsal-$id.txt"
fails=0
pass() { printf 'PASS  %s\n' "$1"; }
fail() {
  printf 'FAIL  %s\n' "$1"
  fails=$((fails + 1))
}

cleanup() {
  bash "$DEPLOY_DIR/restore.sh" --cleanup "$id" >/dev/null 2>&1 || true
  psql_prod -c 'drop table if exists restore_rehearsal' >/dev/null 2>&1 || true
  compose exec -T chat-backend rm -f "$media_file" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# The newest WAL timeline in the bucket. A restored copy that archived would push a new one.
newest_timeline() {
  compose exec -T backup sh -c 'wal-g wal-show --detailed-json 2>/dev/null | jq -e "map(.id) | max"'
}

log "writing markers"
psql_prod -c 'create table if not exists restore_rehearsal (id serial primary key, label text not null, at timestamptz not null default now())' >/dev/null
psql_prod -c "insert into restore_rehearsal (label) values ('A-$id')" >/dev/null
sleep 2
target="$(psql_prod -c "select to_char(now() at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.US') || '+00'")"
sleep 2
psql_prod -c "insert into restore_rehearsal (label) values ('B-$id')" >/dev/null
echo "A-$id before, B-$id after the target $target"
wal_switch_and_wait
timeline_before="$(newest_timeline)" || die "wal-g wal-show failed; check deploy/env/backup.env"

started=$SECONDS
RESTORE_ID="$id" bash "$DEPLOY_DIR/restore.sh" --scratch --target-time "$target"
restore_seconds=$((SECONDS - started))
container="fetivi-restore-db-$id"
scratch() { docker exec "$container" psql -v ON_ERROR_STOP=1 -tA -c "$1"; }

log "checking the restored copy"
labels="$(scratch "select coalesce(string_agg(label, ',' order by id), '') from restore_rehearsal where label like '%-$id'")"
if [[ "$labels" == "A-$id" ]]; then
  pass "restored to the target: A present, B absent"
else
  fail "restored to the target: expected A-$id only, found '$labels'"
fi
migrations="$(scratch 'select count(*) from drizzle.__drizzle_migrations')"
if ((migrations > 0)); then pass "schema present ($migrations migrations)"; else fail "schema present"; fi
archive_mode="$(scratch 'show archive_mode')"
if [[ "$archive_mode" == "off" ]]; then
  pass "the scratch copy does not archive"
else
  fail "the scratch copy does not archive (archive_mode=$archive_mode)"
fi
timeline_after="$(newest_timeline)" || true
if [[ "$timeline_after" == "$timeline_before" ]]; then
  pass "the bucket's newest timeline is unchanged ($timeline_before)"
else
  fail "the bucket's newest timeline is unchanged ($timeline_before -> '$timeline_after')"
fi

log "media round trip"
compose exec -T chat-backend sh -c "echo 'restore rehearsal $id' > '$media_file'"
want="$(compose exec -T chat-backend sha256sum "$media_file" | cut -d' ' -f1)"
compose exec -T backup restic backup /media --tag media --quiet
got="$(docker run --rm --network "${PROJECT}_internal" --env-file "$DEPLOY_DIR/env/backup.env" "$PG_IMAGE" \
  sh -c "restic restore latest --tag media --target /tmp/r --include '/media/rehearsal-$id.txt' >/dev/null &&
    sha256sum '/tmp/r/media/rehearsal-$id.txt'" | cut -d' ' -f1)"
if [[ -n "$want" && "$got" == "$want" ]]; then
  pass "media file restored from the newest snapshot"
else
  fail "media file restored from the newest snapshot (sha256 $want vs '$got')"
fi

log "rehearsal summary"
echo "target time:      $target"
echo "scratch restore:  ${restore_seconds} s (fetch + recovery)"
if ((fails > 0)); then
  echo "RESULT: FAIL ($fails)"
  exit 1
fi
echo "RESULT: PASS"
