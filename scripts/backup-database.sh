#!/bin/sh
set -eu
umask 077
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
backup_dir="${COFLOW_BACKUP_DIR:-backups}"
mkdir -p "$backup_dir"
backup_file="$backup_dir/coflow-$(date -u +%Y%m%dT%H%M%SZ)-$$.dump"
trap 'rm -f "$backup_file.tmp"' EXIT HUP INT TERM
docker compose --env-file "${COFLOW_ENV_FILE:-.env.production}" -f "${COFLOW_COMPOSE_FILE:-compose.production.yaml}" exec -T db \
  pg_dump -U coflow -d coflow --format=custom --no-owner --no-acl > "$backup_file.tmp"
test -s "$backup_file.tmp"
mv "$backup_file.tmp" "$backup_file"
printf '%s\n' "$backup_file"
