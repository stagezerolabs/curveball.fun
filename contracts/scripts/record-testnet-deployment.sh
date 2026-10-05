#!/usr/bin/env bash
set -euo pipefail

rpc_url="${RISE_TESTNET_RPC_URL:-https://testnet.riselabs.xyz}"
broadcast="${BROADCAST_FILE:-broadcast/DeployTestnet.s.sol/11155931/run-latest.json}"
output="${DEPLOYMENT_OUTPUT:-../deployments/11155931/curveball.json}"
explorer_api="${BLOCKSCOUT_API:-https://explorer.testnet.riselabs.xyz/api}"

for command in cast curl jq; do
  command -v "$command" >/dev/null || { echo "Missing required command: $command" >&2; exit 1; }
done

[[ -f "$broadcast" ]] || { echo "Missing broadcast receipt: $broadcast" >&2; exit 1; }
[[ "$(cast chain-id --rpc-url "$rpc_url")" == "11155931" ]] || {
  echo "RPC is not RISE Testnet (11155931)." >&2
  exit 1
}

locker="$(jq -er '.returns.locker.value' "$broadcast")"
launchpad="$(jq -er '.returns.launchpad.value' "$broadcast")"
locker_tx="$(jq -er '.transactions[] | select(.contractName == "LpLocker" and .transactionType == "CREATE") | .hash' "$broadcast")"
launchpad_tx="$(jq -er '.transactions[] | select(.contractName == "CurveballLaunchpad" and .transactionType == "CREATE") | .hash' "$broadcast")"
binding_tx="$(jq -er '.transactions[] | select(.contractName == "LpLocker" and .transactionType == "CALL") | .hash' "$broadcast")"

launchpad_receipt="$(cast receipt "$launchpad_tx" --rpc-url "$rpc_url" --json)"
deployment_block_hex="$(jq -er '.blockNumber' <<<"$launchpad_receipt")"
deployment_block="$(cast to-dec "$deployment_block_hex")"
deployer="$(jq -er '.from' <<<"$launchpad_receipt")"

code_hash() {
  cast code "$1" --rpc-url "$rpc_url" | cast keccak
}

source_verified() {
  local address="$1"
  curl -fsSLG "$explorer_api" \
    --data-urlencode module=contract \
    --data-urlencode action=getsourcecode \
    --data-urlencode address="$address" |
    jq -e '.result[0].SourceCode | type == "string" and . != "" and . != "0x"' >/dev/null 2>&1
}

launchpad_verified=false
locker_verified=false
source_verified "$launchpad" && launchpad_verified=true
source_verified "$locker" && locker_verified=true

quote="$(cast call "$launchpad" 'quote()(address)' --rpc-url "$rpc_url")"
factory="$(cast call "$launchpad" 'factory()(address)' --rpc-url "$rpc_url")"
bound_locker="$(cast call "$launchpad" 'locker()(address)' --rpc-url "$rpc_url")"
bound_launchpad="$(cast call "$locker" 'launchpad()(address)' --rpc-url "$rpc_url")"
treasury="$(cast call "$locker" 'treasury()(address)' --rpc-url "$rpc_url")"
creator_share_bps="$(cast call "$locker" 'creatorShareBps()(uint16)' --rpc-url "$rpc_url")"
supply="$(cast call "$launchpad" 'supply()(uint256)' --rpc-url "$rpc_url" | cut -d' ' -f1)"
curve_supply="$(cast call "$launchpad" 'curveSupply()(uint256)' --rpc-url "$rpc_url" | cut -d' ' -f1)"
initial_virtual_quote="$(cast call "$launchpad" 'initialVQ()(uint256)' --rpc-url "$rpc_url" | cut -d' ' -f1)"

lower() {
  tr '[:upper:]' '[:lower:]' <<<"$1"
}

[[ "$(lower "$quote")" == "0x4200000000000000000000000000000000000006" ]] || { echo "Wrong quote token." >&2; exit 1; }
[[ "$(lower "$factory")" == "0x8221dfb70c9a2de60253dcfc58231fd529bbf4f9" ]] || { echo "Wrong Icarus factory." >&2; exit 1; }
[[ "$(lower "$bound_locker")" == "$(lower "$locker")" && "$(lower "$bound_launchpad")" == "$(lower "$launchpad")" ]] || {
  echo "Launchpad/locker binding mismatch." >&2
  exit 1
}

mkdir -p "$(dirname "$output")"
jq -n \
  --argjson chain_id 11155931 \
  --argjson deployment_block "$deployment_block" \
  --arg deployer "$deployer" \
  --arg launchpad "$launchpad" \
  --arg launchpad_tx "$launchpad_tx" \
  --arg launchpad_hash "$(code_hash "$launchpad")" \
  --argjson launchpad_verified "$launchpad_verified" \
  --arg locker "$locker" \
  --arg locker_tx "$locker_tx" \
  --arg binding_tx "$binding_tx" \
  --arg locker_hash "$(code_hash "$locker")" \
  --argjson locker_verified "$locker_verified" \
  --arg quote "$quote" \
  --arg factory "$factory" \
  --arg supply "$supply" \
  --arg curve_supply "$curve_supply" \
  --arg initial_virtual_quote "$initial_virtual_quote" \
  --argjson creator_share_bps "$creator_share_bps" \
  --arg treasury "$treasury" \
  '{
    chainId: $chain_id,
    deploymentBlock: $deployment_block,
    deployer: $deployer,
    launchpad: {address: $launchpad, transactionHash: $launchpad_tx, codeHash: $launchpad_hash, verified: $launchpad_verified},
    locker: {address: $locker, transactionHash: $locker_tx, bindingTransactionHash: $binding_tx, codeHash: $locker_hash, verified: $locker_verified},
    quoteToken: $quote,
    icarusFactory: $factory,
    tokenSupply: $supply,
    curveSupply: $curve_supply,
    initialVirtualQuote: $initial_virtual_quote,
    creatorShareBps: $creator_share_bps,
    initialTreasury: $treasury
  }' > "$output"

cat "$output"
