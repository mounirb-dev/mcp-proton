#!/bin/sh
# Arranca MinIO y crea el bucket si no existe. Variables: MINIO_ROOT_USER, MINIO_ROOT_PASSWORD (>= 8), S3_BUCKET.
set -e
: "${MINIO_ROOT_USER:?define MINIO_ROOT_USER}"
: "${MINIO_ROOT_PASSWORD:?define MINIO_ROOT_PASSWORD (>= 8 caracteres)}"
BUCKET="${S3_BUCKET:-proton-mcp}"

minio server /data --address ":9000" --quiet &
PID=$!
trap 'kill -TERM "$PID" 2>/dev/null; wait "$PID"; exit 0' TERM INT

# espera a que acepte peticiones y crea el bucket (idempotente)
for _ in $(seq 1 60); do
  wget -q -O /dev/null http://127.0.0.1:9000/minio/health/ready && break
  sleep 1
done
mcli --config-dir /tmp/mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mcli --config-dir /tmp/mc mb --ignore-existing "local/$BUCKET" >/dev/null

wait "$PID"
