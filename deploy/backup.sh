#!/usr/bin/env bash
# Nightly: database dump + uploaded files. Keeps 14 days on the server.
# Copy backups off the server too (see README): a server-only backup doesn't survive losing the server.
set -euo pipefail
BASE=/var/www/scoothero-backoffice
set -a; . $BASE/shared/.env; set +a
STAMP=$(date +%Y%m%d-%H%M)
pg_dump --format=custom "$DATABASE_URL" > $BASE/backups/db-$STAMP.dump
tar -czf $BASE/backups/storage-$STAMP.tgz -C $BASE storage
find $BASE/backups -name 'db-*.dump' -mtime +14 -delete
find $BASE/backups -name 'storage-*.tgz' -mtime +14 -delete
echo "$(date -Is) backup ok"
