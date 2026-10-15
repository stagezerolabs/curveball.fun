#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

readonly chain_id=11155931
readonly admin=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3
readonly confirmation_phrase=DEPLOY_HOLDER_RESERVE_CURVEBALL_RISE_TESTNET_11155931
readonly rpc_url="${TESTNET_RPC_URL:-https://testnet.riselabs.xyz}"
readonly signer_account="${ACCOUNT:-dot}"
readonly broadcast_dir="broadcast/DeployHolderReserveV2.s.sol/${chain_id}"

if [[ ! -t 0 ]]; then
  echo "Run this command in an interactive terminal."
  exit 2
fi
if [[ -f "${broadcast_dir}/run-latest.json" ]] && jq -e '.receipts | length > 0' "${broadcast_dir}/run-latest.json" >/dev/null; then
  echo "A reserve broadcast with receipts already exists at ${broadcast_dir}/run-latest.json; inspect it before retrying."
  exit 2
fi
if [[ "$(cast chain-id --rpc-url "$rpc_url")" != "$chain_id" ]]; then
  echo "RPC is not RISE Testnet (${chain_id})."
  exit 2
fi
if ! cast wallet list | rg -q "^${signer_account} \(Local\)$"; then
  echo "Local Foundry account '${signer_account}' was not found."
  exit 2
fi

make test

printf 'Type %s to deploy the holder-reserve factory to RISE Testnet: ' "$confirmation_phrase"
read -r confirmation
if [[ "$confirmation" != "$confirmation_phrase" ]]; then
  echo "Deployment cancelled."
  exit 2
fi

umask 077
mkdir -p "$broadcast_dir"
log_path="${broadcast_dir}/holder-reserve-deploy-$(date -u +%Y%m%dT%H%M%SZ).log"
echo "Saving deployment output to ${log_path}"

DEPLOYER_ADDRESS="$admin" \
TREASURY="$admin" \
CONFIRM_PERMISSIONLESS_V2_TESTNET=DEPLOY_PERMISSIONLESS_CURVEBALL_V2_RISE_TESTNET_11155931 \
forge script scripts/DeployHolderReserveV2.s.sol:DeployHolderReserveV2 \
  --rpc-url "$rpc_url" \
  --broadcast \
  --slow \
  --account "$signer_account" \
  --sender "$admin" \
  2>&1 | tee "$log_path"

echo "Deployment finished. Review ${broadcast_dir}/run-latest.json and the log before updating frontend configuration."
