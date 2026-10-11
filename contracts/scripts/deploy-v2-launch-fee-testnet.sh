#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

readonly chain_id=11155931
readonly admin=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3
readonly confirmation_phrase=DEPLOY_PERMISSIONLESS_CURVEBALL_V2_RISE_TESTNET_11155931
readonly rpc_url="${TESTNET_RPC_URL:-https://testnet.riselabs.xyz}"
readonly signer_account="${ACCOUNT:-dot}"
readonly broadcast_dir="broadcast/DeployPermissionlessV2.s.sol/${chain_id}"

if [[ ! -t 0 ]]; then
  echo "Run this command in an interactive terminal."
  exit 2
fi
if [[ -f "${broadcast_dir}/run-latest.json" ]]; then
  echo "A completed broadcast file already exists at ${broadcast_dir}/run-latest.json."
  echo "Send that file for review before attempting another deployment."
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

printf 'Type %s to deploy the 0.0004 WETH launch-fee V2 to RISE Testnet: ' "$confirmation_phrase"
read -r confirmation
if [[ "$confirmation" != "$confirmation_phrase" ]]; then
  echo "Deployment cancelled."
  exit 2
fi

umask 077
mkdir -p "$broadcast_dir"
log_path="${broadcast_dir}/launch-fee-deploy-$(date -u +%Y%m%dT%H%M%SZ).log"
echo "Saving deployment output to ${log_path}"

DEPLOYER_ADDRESS="$admin" \
TREASURY="$admin" \
CONFIRM_PERMISSIONLESS_V2_TESTNET="$confirmation_phrase" \
forge script scripts/DeployPermissionlessV2.s.sol:DeployPermissionlessV2 \
  --rpc-url "$rpc_url" \
  --broadcast \
  --slow \
  --account "$signer_account" \
  --sender "$admin" \
  2>&1 | tee "$log_path"

echo "Deployment finished. Send the log and ${broadcast_dir}/run-latest.json for review."
echo "Log: ${log_path}"
