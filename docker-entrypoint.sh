#!/bin/sh
# Arranca como root solo para dejar /data escribible (volúmenes antiguos o montados con otro dueño) y baja a "bun".
set -e
if [ "$(id -u)" = "0" ]; then
  chown -R bun:bun /data 2>/dev/null || true
  exec su-exec bun "$@"
fi
exec "$@"
