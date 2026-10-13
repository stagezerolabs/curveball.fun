#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

readonly chain_id=11155931
readonly factory=0xD0f0cf4fd5Aa9D391477B3B9CF3B77Dc96705056
readonly dot=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3
readonly fee_admin=0x5cc42e772f67089b4670eec4dcd904be2f2d511c
readonly rpc_url="${TESTNET_RPC_URL:-https://testnet.riselabs.xyz}"
readonly signer_account="${ACCOUNT:-dot}"
readonly confirmation_phrase=DEPLOY_DOT_OWNED_CURVEBALL_FEE_CONTROLLER_11155931
readonly expected_code_hash=0xf0accc08a30448e487f7a6a4543226c9bd57517949693b4eb7936570007dc766

lowercase() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }

if [[ ! -t 0 ]]; then echo "Run this command in an interactive terminal." >&2; exit 2; fi
if [[ "$(cast chain-id --rpc-url "$rpc_url")" != "$chain_id" ]]; then echo "RPC is not RISE Testnet." >&2; exit 2; fi
if [[ "$(cast call --rpc-url "$rpc_url" "$factory" 'feeBps()(uint16)')" != 75 ]]; then echo "Expected factory fee to be 75 bps." >&2; exit 2; fi
if ! cast wallet list | rg -q "^${signer_account} \(Local\)$"; then echo "Local Foundry account '${signer_account}' was not found." >&2; exit 2; fi

forge test --match-path 'test/FactoryFeeController.t.sol'
bun ../scripts/check-fee-controller-codehash.ts
printf 'Factory: %s\nSuper admin: %s\nFee admin: %s\n' "$factory" "$dot" "$fee_admin"
printf 'Type %s to deploy the controller: ' "$confirmation_phrase"
read -r confirmation
if [[ "$confirmation" != "$confirmation_phrase" ]]; then echo "Deployment cancelled."; exit 2; fi

deployment="$(forge create contracts/CurveFactoryFeeController.sol:CurveFactoryFeeController \
  --rpc-url "$rpc_url" --account "$signer_account" --from "$dot" --broadcast --json \
  --constructor-args "$factory" "$dot" "$fee_admin")"
printf '%s\n' "$deployment"
controller="$(printf '%s\n' "$deployment" | jq -r '.deployedTo // empty')"
if [[ -z "$controller" ]]; then echo "Deployment returned without a parsed address. Inspect the output before retrying." >&2; exit 1; fi
if [[ "$(lowercase "$(cast codehash --rpc-url "$rpc_url" "$controller")")" != "$expected_code_hash" || \
      "$(lowercase "$(cast call --rpc-url "$rpc_url" "$controller" 'factory()(address)')")" != "$(lowercase "$factory")" || \
      "$(lowercase "$(cast call --rpc-url "$rpc_url" "$controller" 'owner()(address)')")" != "$(lowercase "$dot")" || \
      "$(lowercase "$(cast call --rpc-url "$rpc_url" "$controller" 'feeAdmin()(address)')")" != "$(lowercase "$fee_admin")" ]]; then
  echo "Controller state did not match after deployment. Inspect the transaction." >&2
  exit 1
fi
echo "Controller deployed at $controller. Nominate it from the connected admin wallet in /admin, then run make accept-fee-controller-testnet CONTROLLER=$controller."
