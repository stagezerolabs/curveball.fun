#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "$*" >&2
  exit 2
}

same_address() {
  test "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" = "$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
}

record=deployments/4153/curve-activation-schedule.json
deployment=deployments/4153/curveball-oracle-v3.json
activation=deployments/4153/curve-activation.json
rpc_url=${RISE_MAINNET_RPC_URL:-https://rpc.risechain.com}
zero=0x0000000000000000000000000000000000000000
target=0x65014eDD6ea4A53152780742360Fb4685Abab689
dot=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3

test "$(jq -r '.chainId' "$record")" = 4153 || fail "Activation record is not for RISE mainnet."
test "$(jq -r '.version' "$record")" = oracle-v3 || fail "Activation record is not oracle-v3."
same_address "$(jq -r '.curveToken' "$record")" "$target" || fail "Activation record targets a different token."
test "$(jq -r '.chainId' "$deployment")" = 4153 || fail "Deployment record is not for RISE mainnet."
test "$(jq -r '.version' "$deployment")" = oracle-v3 || fail "Deployment record is not oracle-v3."

treasury=$(jq -r '.buybackTreasury' "$record")
timelock=$(jq -r '.timelock' "$record")
operation=$(jq -r '.operationId' "$record")
data=$(jq -r '.data' "$record")
predecessor=$(jq -r '.predecessor' "$record")
salt=$(jq -r '.salt' "$record")
launchpad=$(jq -r '.launchpad' "$deployment")
escrow=$(jq -r '.singletons.escrow' "$deployment")
same_address "$treasury" "$(jq -r '.singletons.buybackTreasury' "$deployment")" || fail "Treasury differs from deployment record."
test "$(cast chain-id --rpc-url "$rpc_url")" = 4153 || fail "RPC is not RISE mainnet."
same_address "$(cast call "$launchpad" 'escrow()(address)' --rpc-url "$rpc_url")" "$escrow" || fail "Launchpad escrow mismatch."
same_address "$(cast call "$escrow" 'buybackTreasury()(address)' --rpc-url "$rpc_url")" "$treasury" || fail "Launchpad uses another treasury."
same_address "$(cast call "$treasury" 'owner()(address)' --rpc-url "$rpc_url")" "$timelock" || fail "Treasury owner is not the recorded timelock."
same_address "$(cast call "$treasury" 'launchpad()(address)' --rpc-url "$rpc_url")" "$launchpad" || fail "Treasury uses another launchpad."

selected=$(cast call "$treasury" 'curveToken()(address)' --rpc-url "$rpc_url")
if same_address "$selected" "$target"; then
  echo "CURVE is already selected in the mainnet buyback treasury."
  if test ! -e "$activation"; then
    CURVE_CHAIN_ID=4153 CURVE_RPC_URL="$rpc_url" CURVE_TOKEN_ADDRESS="$target" bun contracts/scripts/record-curve-activation.ts
  fi
  exit 0
fi
same_address "$selected" "$zero" || fail "Treasury already selected another token: $selected"
test ! -e "$activation" || fail "$activation exists while the treasury target is unset."

pool=$(cast call "$launchpad" 'poolOf(address)(address)' "$target" --rpc-url "$rpc_url")
same_address "$pool" "$zero" && fail "CURVE has not graduated; setCurveToken would revert."
seed=$(cast call "$treasury" 'seedObservations(address)(uint256)' "$target" --rpc-url "$rpc_url")
test "$seed" != 0 || fail "CURVE pool observations are not seeded."

same_address "$(cast calldata 'setCurveToken(address)' "$target")" "$data" || fail "Scheduled calldata does not select CURVE."
computed=$(cast call "$timelock" 'hashOperation(address,uint256,bytes,bytes32,bytes32)(bytes32)' "$treasury" 0 "$data" "$predecessor" "$salt" --rpc-url "$rpc_url")
same_address "$computed" "$operation" || fail "Scheduled operation ID mismatch."
ready=$(cast call "$timelock" 'isOperationReady(bytes32)(bool)' "$operation" --rpc-url "$rpc_url")
test "$ready" = true || fail "Timelock operation is not ready; recorded unlock is $(jq -r '.readyAt' "$record")."
executor_role=$(cast call "$timelock" 'EXECUTOR_ROLE()(bytes32)' --rpc-url "$rpc_url")
test "$(cast call "$timelock" 'hasRole(bytes32,address)(bool)' "$executor_role" "$dot" --rpc-url "$rpc_url")" = true || fail "Dot is not a timelock executor."

echo "Executing the scheduled CURVE selection through the timelock with the dot keystore."
cast send "$timelock" 'execute(address,uint256,bytes,bytes32,bytes32)' "$treasury" 0 "$data" "$predecessor" "$salt" --rpc-url "$rpc_url" --account dot
same_address "$(cast call "$treasury" 'curveToken()(address)' --rpc-url "$rpc_url")" "$target" || fail "Transaction did not set CURVE as the buyback target."
CURVE_CHAIN_ID=4153 CURVE_RPC_URL="$rpc_url" CURVE_TOKEN_ADDRESS="$target" bun contracts/scripts/record-curve-activation.ts
