# Postgres with WAL-G (continuous WAL archiving + base backups) and restic (the media volume).
# Used by both the postgres service and the backup sidecar. Build context is the repo root.
FROM postgis/postgis:16-3.6

ARG WALG_VERSION=v3.0.9
ARG WALG_SHA256=4f03ee4679db7f660bfd1b2b8291ac5df247cd2ec48074b60c112f4897299f24
ARG RESTIC_VERSION=0.18.1
ARG RESTIC_SHA256=680838f19d67151adba227e1570cdd8af12c19cf1735783ed1ba928bc41f363d

RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates jq bzip2 \
  && rm -rf /var/lib/apt/lists/* \
  && cd /tmp \
  && curl -fsSLo wal-g.tar.gz "https://github.com/wal-g/wal-g/releases/download/${WALG_VERSION}/wal-g-pg-22.04-amd64.tar.gz" \
  && echo "${WALG_SHA256}  wal-g.tar.gz" | sha256sum -c - \
  && tar -xzf wal-g.tar.gz \
  && install -m 0755 wal-g-pg-22.04-amd64 /usr/local/bin/wal-g \
  && curl -fsSLo restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2" \
  && echo "${RESTIC_SHA256}  restic.bz2" | sha256sum -c - \
  && bunzip2 restic.bz2 \
  && install -m 0755 restic /usr/local/bin/restic \
  && rm -rf /tmp/*

# The media volume's owner is the node user (uid 1000) of the app images. A named volume takes the
# ownership of the first container's mount point, and the backup sidecar may mount it first.
RUN mkdir -p /media && chown 1000:1000 /media

COPY deploy/postgres/*.sh /usr/local/bin/
RUN chmod 0755 /usr/local/bin/backup-now.sh /usr/local/bin/backup-loop.sh
