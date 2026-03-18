#!/bin/sh
if [ "$(id -u)" = '0' ]; then
  chown -R node:node /data 2>/dev/null
  exec su-exec node "$@"
fi
exec "$@"
