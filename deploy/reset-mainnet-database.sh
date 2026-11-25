#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
if [[ "$PWD" != /opt/curveball-mainnet ]]; then
  echo "Run this target on the production VPS from /opt/curveball-mainnet." >&2
  exit 2
fi
if [[ "${CONFIRM_RESET:-}" != DELETE_ALL_CURVEBALL_MAINNET_DATA ]]; then
  echo "Set CONFIRM_RESET=DELETE_ALL_CURVEBALL_MAINNET_DATA to remove all mainnet profiles, markets, trades, and on-host backups." >&2
  exit 2
fi

python3 deploy/configure-mainnet-host.py --check >/dev/null

compose=(docker compose --env-file deploy/production.env -f compose.production.yaml -f deploy/compose.mainnet.yaml)
"${compose[@]}" config --quiet
configured_volumes=$("${compose[@]}" config --volumes)
[[ "$(printf '%s\n' "$configured_volumes" | sed '/^$/d' | wc -l | tr -d ' ')" == 2 ]] || { echo "Unexpected production volume set." >&2; exit 2; }
printf '%s\n' "$configured_volumes" | grep -Fxq postgres_data || { echo "Postgres data volume is missing." >&2; exit 2; }
printf '%s\n' "$configured_volumes" | grep -Fxq postgres_backups || { echo "Postgres backup volume is missing." >&2; exit 2; }
"${compose[@]}" build api keeper
"${compose[@]}" down --volumes --remove-orphans
for volume in curveball-mainnet-postgres-data curveball-mainnet-postgres-backups; do
  if docker volume inspect "$volume" >/dev/null 2>&1; then
    echo "The old $volume volume still exists; refusing to restart." >&2
    exit 2
  fi
done
"${compose[@]}" up -d --no-build --remove-orphans --wait --wait-timeout 300
"${compose[@]}" ps
