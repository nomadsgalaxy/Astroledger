#!/bin/bash
# Clean import of prisma/dev.db → Docker volume via SQL dump + restore.
# Use this if `docker cp` of the binary file leaves SQLite in a weird state
# (read-only errors, lock-state issues from cross-host copies).
set -e
SRC="${1:-prisma/dev.db}"
VOLUME="${2:-budgetman_astroledger-data}"

if [ ! -f "$SRC" ]; then
  echo "Source DB not found: $SRC"
  exit 1
fi

echo "[db-import] dumping $SRC to SQL …"
sqlite3 "$SRC" ".dump" > /tmp/astroledger-dump.sql
echo "[db-import] dump is $(wc -c < /tmp/astroledger-dump.sql) bytes"

echo "[db-import] stopping astroledger container …"
docker compose stop astroledger >/dev/null 2>&1

echo "[db-import] restoring into volume $VOLUME …"
# Run alpine with sqlite, mount the volume read-write, pipe the dump in,
# and chown the result to 1001:1001 (astroledger user in the container).
docker run --rm -i -v "$VOLUME:/data" alpine sh -c '
  apk add --no-cache sqlite >/dev/null
  [ -f /data/astroledger.db ] && mv /data/astroledger.db /data/astroledger.db.pre-import-backup
  sqlite3 /data/astroledger.db
  chown -R 1001:1001 /data
  chmod 644 /data/astroledger.db
  ls -la /data/
' < /tmp/astroledger-dump.sql

rm /tmp/astroledger-dump.sql

echo "[db-import] starting astroledger container …"
docker compose up -d astroledger >/dev/null
echo "[db-import] done."
