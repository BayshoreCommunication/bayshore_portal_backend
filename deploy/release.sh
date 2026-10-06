#!/usr/bin/env bash
# Runs on the droplet, piped over SSH by the deploy workflow. Unpacks a build into
# its own release folder, points `current` at it, reloads PM2, and switches back to
# the previous release if the health check does not come up.
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/bayshoreportal_backend}"
APP_NAME="bayshoreportal_backend"
KEEP_RELEASES=5

activate() {
  ln -sfn "$1" "$APP_DIR/current"
  pm2 startOrReload "$APP_DIR/current/ecosystem.config.js" --update-env
}

healthy() {
  local port
  port="$(grep -E '^PORT=' "$APP_DIR/shared/.env" | tail -1 | cut -d= -f2 | tr -d "\"' \r" || true)"
  port="${port:-5000}"

  for _ in $(seq 1 15); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$port/api/v1/health"; then
      return 0
    fi
    sleep 2
  done
  return 1
}

prune() {
  ls -1d "$APP_DIR"/releases/*/ | sort -r | tail -n +"$((KEEP_RELEASES + 1))" | xargs -r rm -rf
}

# Wrapped in a function so bash has read the whole script before anything runs —
# it arrives on stdin, and a child process must not be able to swallow the rest.
main() {
  local sha="${1:?usage: release.sh <git sha>}"
  local archive="$APP_DIR/incoming/$sha.tgz"
  local release
  release="$APP_DIR/releases/$(date +%Y%m%d%H%M%S)-${sha:0:7}"

  local previous=""
  if [ -L "$APP_DIR/current" ]; then
    previous="$(readlink -f "$APP_DIR/current")"
  fi

  if [ ! -s "$APP_DIR/shared/.env" ]; then
    echo "Missing or empty $APP_DIR/shared/.env — add the production env before deploying." >&2
    exit 1
  fi

  mkdir -p "$release"
  tar -xzf "$archive" -C "$release"
  rm -f "$archive"
  ln -sfn "$APP_DIR/shared/.env" "$release/.env"

  activate "$release"

  if healthy; then
    pm2 save
    prune
    echo "Released $release"
    return 0
  fi

  echo "Health check failed for $release" >&2
  pm2 logs "$APP_NAME" --lines 40 --nostream >&2 || true

  if [ -n "$previous" ] && [ -d "$previous" ]; then
    activate "$previous"
    if healthy; then
      echo "Rolled back to $previous" >&2
    else
      echo "Rolled back to $previous, but it is not answering the health check either" >&2
    fi
  fi
  rm -rf "$release"
  exit 1
}

main "$@"
