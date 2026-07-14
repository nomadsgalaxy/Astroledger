#!/bin/sh
set -eu
umask 077

ADMIN="/app/scripts/db-encryption-admin.mjs"
PRISMA_BIN="/usr/local/lib/node_modules/prisma/build/index.js"

secure_database_files() {
  db_url="${DATABASE_URL:-file:/data/astroledger.db}"
  case "$db_url" in
    file:*) db_file="${db_url#file:}" ;;
    *) return ;;
  esac
  for file in "$db_file" "$db_file-wal" "$db_file-shm"; do
    if [ -e "$file" ]; then chmod 600 "$file"; fi
  done
}

# Provider/API credentials can be injected after container creation from a
# root-managed read-only file. They therefore do not appear in `docker inspect`
# or the Compose project environment.
if [ -n "${ASTROLEDGER_RUNTIME_ENV_FILE:-}" ]; then
  if [ ! -r "$ASTROLEDGER_RUNTIME_ENV_FILE" ]; then
    echo "[astroledger] FATAL: runtime environment file is unreadable"
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  . "$ASTROLEDGER_RUNTIME_ENV_FILE"
  set +a
fi

secret_present() {
  file_var="$1"
  value_var="$2"
  eval "file_value=\${$file_var:-}"
  eval "direct_value=\${$value_var:-}"
  if [ -n "$file_value" ]; then
    [ -r "$file_value" ] && [ -s "$file_value" ]
  else
    [ -n "$direct_value" ]
  fi
}

if [ "$NODE_ENV" = "production" ]; then
  if [ "${ASTROLEDGER_DB_ENCRYPTED:-}" != "true" ]; then
    echo "[astroledger] FATAL: production requires ASTROLEDGER_DB_ENCRYPTED=true"
    exit 1
  fi
  secret_present ASTROLEDGER_DB_KEY_FILE SQLCIPHER_KEY || {
    echo "[astroledger] FATAL: database encryption key is missing or unreadable"
    exit 1
  }
  secret_present ASTROLEDGER_MASTER_KEY_FILE MASTER_KEY || {
    echo "[astroledger] FATAL: field-encryption key is missing or unreadable"
    exit 1
  }
  secret_present ASTROLEDGER_BACKUP_KEY_FILE ASTROLEDGER_BACKUP_KEY || {
    echo "[astroledger] FATAL: backup encryption key is missing or unreadable"
    exit 1
  }
fi

if [ ! -f "$ADMIN" ]; then
  echo "[astroledger] FATAL: encrypted database administration tool is missing"
  exit 1
fi

secure_database_files

# Legacy deployments were maintained with `prisma db push` and may predate the
# first versioned migration. Reconcile that plaintext schema once, with an
# encrypted snapshot first, then baseline all migrations after encryption.
BASELINE_ALL=false
if node "$ADMIN" is-plaintext; then
  node "$ADMIN" snapshot
  node "$PRISMA_BIN" db push --schema=/app/prisma/schema.prisma --skip-generate --accept-data-loss=false
  BASELINE_ALL=true
fi

# Every operation fails closed. The plaintext source, if this is the first
# encrypted boot, is snapshotted into an AES-GCM backup before being retired.
node "$ADMIN" migrate
if [ "$BASELINE_ALL" = "true" ]; then node "$ADMIN" baseline-all; fi
node "$ADMIN" migrate-schema
node "$ADMIN" migrate-fields
node "$ADMIN" migrate-receipts
node "$ADMIN" verify
secure_database_files

if [ "${DEMO_MODE:-}" = "true" ]; then
  SANDBOX_DIR="${ASTROLEDGER_SANDBOX_DIR:-/data/sandboxes}"
  mkdir -p "$SANDBOX_DIR"
  # Demo data is synthetic and disposable. Purging old sandboxes guarantees no
  # pre-encryption visitor DB survives this deployment.
  find "$SANDBOX_DIR" -maxdepth 1 -type f -name '*.db*' -delete
  SEED_TMP="/run/astroledger-backup/demo-seed.db"
  rm -f "$SEED_TMP" "$SEED_TMP-wal" "$SEED_TMP-shm"
  if [ -f /app/prisma/sandboxes/_seed.db ]; then
    cp /app/prisma/sandboxes/_seed.db "$SEED_TMP"
  elif [ -f /app/prisma/demo.db ]; then
    cp /app/prisma/demo.db "$SEED_TMP"
  else
    echo "[astroledger] FATAL: demo seed database is missing"
    exit 1
  fi
  chmod 600 "$SEED_TMP"
  DATABASE_URL="file:$SEED_TMP" node "$ADMIN" snapshot
  DATABASE_URL="file:$SEED_TMP" node "$PRISMA_BIN" db push --schema=/app/prisma/schema.prisma --skip-generate --accept-data-loss=false
  DATABASE_URL="file:$SEED_TMP" node "$ADMIN" migrate
  DATABASE_URL="file:$SEED_TMP" node "$ADMIN" baseline-all
  DATABASE_URL="file:$SEED_TMP" node "$ADMIN" migrate-schema
  DATABASE_URL="file:$SEED_TMP" node "$ADMIN" migrate-fields
  DATABASE_URL="file:$SEED_TMP" node "$ADMIN" refresh-demo-dates
  DATABASE_URL="file:$SEED_TMP" node "$ADMIN" verify
  cp "$SEED_TMP" "$SANDBOX_DIR/_seed.db"
  chmod 600 "$SANDBOX_DIR/_seed.db"
  rm -f "$SEED_TMP" "$SEED_TMP-wal" "$SEED_TMP-shm"
fi

echo "[astroledger] launching: $*"
exec "$@"
