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

record=deployments/4153/curveball-oracle-v3.json
adapter=deployments/4153/icarus-swap-adapter-oracle-v3.json
[[ -f "$record" && -f "$adapter" ]] || { echo "Oracle launchpad and swap adapter records are required." >&2; exit 2; }
launchpad=$(jq -er 'select(.chainId == 4153 and .version == "oracle-v3" and .maxOracleAgeSeconds == "1800" and .launchFeeUsd == "1000000000000000000") | .launchpad | select(test("^0x[0-9a-fA-F]{40}$"))' "$record")
jq -e --arg launchpad "$launchpad" '.chainId == 4153 and (.launchpad | ascii_downcase) == ($launchpad | ascii_downcase) and (.adapter | test("^0x[0-9a-fA-F]{40}$"))' "$adapter" >/dev/null

env_value() {
  local key="$1" file="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}
for file in .env.production deploy/production.env; do
  [[ -f "$file" ]] || { echo "Missing $file" >&2; exit 2; }
  [[ "$(env_value VITE_CHAIN_ID "$file")" == 4153 ]] || { echo "$file is not RISE mainnet." >&2; exit 2; }
  [[ "${launchpad,,}" == "$(env_value VITE_LAUNCHPAD_ADDRESS "$file" | tr '[:upper:]' '[:lower:]')" ]] || { echo "$file points at another launchpad." >&2; exit 2; }
done
for entry in "deploy/social.env:SOCIAL" "deploy/keeper.env:KEEPER"; do
  file=${entry%%:*}
  prefix=${entry##*:}
  [[ -f "$file" ]] || { echo "Missing $file" >&2; exit 2; }
  [[ "$(env_value "${prefix}_CHAIN_ID" "$file")" == 4153 ]] || { echo "$file is not RISE mainnet." >&2; exit 2; }
  [[ "${launchpad,,}" == "$(env_value "${prefix}_LAUNCHPAD_ADDRESS" "$file" | tr '[:upper:]' '[:lower:]')" ]] || { echo "$file points at another launchpad." >&2; exit 2; }
done

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
