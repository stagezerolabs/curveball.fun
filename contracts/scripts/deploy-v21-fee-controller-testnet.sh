#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
readonly chain_id=11155931
readonly factory=0x6c12CCE962944EbB6A28536eD23baeFAa15c79cD
readonly dot=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3
readonly rpc_url="${TESTNET_RPC_URL:-https://testnet.riselabs.xyz}"
readonly account="${ACCOUNT:-dot}"
readonly broadcast_dir="broadcast/DeployV21FeeController.s.sol/${chain_id}"

[[ -t 0 ]] || { echo "Run this command in an interactive terminal." >&2; exit 2; }
if [[ -f "${broadcast_dir}/run-latest.json" ]] && jq -e '.receipts | length > 0' "${broadcast_dir}/run-latest.json" >/dev/null; then
  echo "Controller broadcast receipts already exist; inspect ${broadcast_dir}/run-latest.json before retrying." >&2
  exit 2
fi
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "$chain_id" ]] || { echo "RPC is not RISE Testnet." >&2; exit 2; }
[[ "$(cast call "$factory" 'owner()(address)' --rpc-url "$rpc_url")" == "$dot" ]] || { echo "Dot no longer owns V2.1 factory." >&2; exit 2; }
cast wallet list | rg -q "^${account} \(Local\)$" || { echo "Local signer ${account} was not found." >&2; exit 2; }
forge test --match-path 'test/FactoryFeeController.t.sol' --threads 1

printf 'Type DEPLOY_V21_FEE_CONTROLLER_RISE_TESTNET_11155931 to transfer V2.1 factory ownership to the new controller: '
read -r confirmation
[[ "$confirmation" == DEPLOY_V21_FEE_CONTROLLER_RISE_TESTNET_11155931 ]] || { echo "Cancelled." >&2; exit 2; }

forge script scripts/DeployV21FeeController.s.sol:DeployV21FeeController \
  --rpc-url "$rpc_url" --broadcast --slow --account "$account" --sender "$dot"
echo "Controller handoff finished. Verify the three transaction receipts and record its address."
