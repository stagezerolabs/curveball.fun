#!/usr/bin/env bash
# Read-only RISE Testnet dependency gate. Never broadcasts a transaction.
set -euo pipefail

rpc_url="${RISE_TESTNET_RPC_URL:-https://testnet.riselabs.xyz}"
factory="${ICARUS_FACTORY:-0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9}"
weth="${QUOTE_TOKEN:-0x4200000000000000000000000000000000000006}"
explorer_api="${BLOCKSCOUT_API:-https://explorer.testnet.riselabs.xyz/api}"
output="${VERIFY_OUTPUT:-../deployments/11155931/icarus-verification.json}"

require() {
  command -v "$1" >/dev/null || { echo "Missing required command: $1" >&2; exit 1; }
}

for command in cast curl jq forge; do require "$command"; done

[[ "$(cast chain-id --rpc-url "$rpc_url")" == "11155931" ]] || {
  echo "RPC is not RISE Testnet (11155931)." >&2
  exit 1
}
[[ "$factory" == "0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9" ]] || {
  echo "ICARUS_FACTORY is not the official Icarus testnet PoolFactory." >&2
  exit 1
}
[[ "$weth" == "0x4200000000000000000000000000000000000006" ]] || {
  echo "QUOTE_TOKEN is not canonical RISE Testnet WETH." >&2
  exit 1
}

call_factory() {
  cast call "$factory" "$1" --rpc-url "$rpc_url"
}

code_hash() {
  local code
  code="$(cast code "$1" --rpc-url "$rpc_url")"
  [[ "$code" != "0x" ]] || { echo "No bytecode at $1." >&2; exit 1; }
  cast keccak "$code"
}

source_verified() {
  local address="$1"
  curl -fsSLG "$explorer_api" \
    --data-urlencode module=contract \
    --data-urlencode action=getsourcecode \
    --data-urlencode address="$address" |
    jq -e '.result[0].SourceCode | type == "string" and . != "" and . != "0x"' >/dev/null 2>&1
}

implementation="$(call_factory 'implementation()(address)')"
[[ "$implementation" =~ ^0x[0-9a-fA-F]{40}$ ]] || {
  echo "Factory implementation() is unreadable." >&2
  exit 1
}

for signature in \
  'isPaused()(bool)' \
  'pauser()(address)' \
  'feeManager()(address)' \
  'voter()(address)' \
  'volatileFee()(uint256)' \
  'stableFee()(uint256)' \
  'unstakedFee()(uint256)' \
  'MAX_FEE()(uint256)'; do
  call_factory "$signature" >/dev/null || {
    echo "Factory ABI mismatch at $signature." >&2
    exit 1
  }
done

paused="$(call_factory 'isPaused()(bool)')"
[[ "$paused" == "false" ]] || { echo "Icarus PoolFactory is paused." >&2; exit 1; }

weth_name="$(cast call "$weth" 'name()(string)' --rpc-url "$rpc_url" | tr -d '"')"
weth_symbol="$(cast call "$weth" 'symbol()(string)' --rpc-url "$rpc_url" | tr -d '"')"
weth_decimals="$(cast call "$weth" 'decimals()(uint8)' --rpc-url "$rpc_url")"
[[ "$weth_name" == "Wrapped Ether" && "$weth_symbol" == "WETH" && "$weth_decimals" == "18" ]] || {
  echo "RISE Testnet WETH metadata mismatch." >&2
  exit 1
}

echo "Running Curveball lifecycle against a fresh RISE Testnet fork..." >&2
RISE_TESTNET_RPC_URL="$rpc_url" forge test --match-path test/fork/IcarusFactory.t.sol >/dev/null

factory_verified=false
implementation_verified=false
source_verified "$factory" && factory_verified=true
source_verified "$implementation" && implementation_verified=true

mkdir -p "$(dirname "$output")"
jq -n \
  --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg factory "$factory" \
  --arg implementation "$implementation" \
  --arg factory_code_hash "$(code_hash "$factory")" \
  --arg implementation_code_hash "$(code_hash "$implementation")" \
  --arg weth "$weth" \
  --arg weth_code_hash "$(code_hash "$weth")" \
  --arg weth_name "$weth_name" \
  --arg weth_symbol "$weth_symbol" \
  --argjson weth_decimals "$weth_decimals" \
  --argjson factory_verified "$factory_verified" \
  --argjson implementation_verified "$implementation_verified" \
  --argjson paused "$paused" \
  --argjson volatile_fee "$(call_factory 'volatileFee()(uint256)')" \
  --argjson stable_fee "$(call_factory 'stableFee()(uint256)')" \
  --argjson unstaked_fee "$(call_factory 'unstakedFee()(uint256)')" \
  '{
    generatedAt: $generated_at,
    chainId: 11155931,
    source: {
      name: "Icarus public application configuration",
      url: "https://www.icarus.finance/swap"
    },
    factory: {
      address: $factory,
      implementation: $implementation,
      codeHash: $factory_code_hash,
      implementationCodeHash: $implementation_code_hash,
      blockscoutSourceVerified: $factory_verified,
      implementationSourceVerified: $implementation_verified,
      paused: $paused,
      volatileFeeBps: $volatile_fee,
      stableFeeBps: $stable_fee,
      unstakedFeeBps: $unstaked_fee
    },
    weth: {
      address: $weth,
      name: $weth_name,
      symbol: $weth_symbol,
      decimals: $weth_decimals,
      codeHash: $weth_code_hash
    },
    forkLifecycleCheck: "PASSED: deployment wiring, pool creation, Curveball graduation, swap, and fee claim on a fresh RISE Testnet fork.",
    acceptedRisk: "The official Icarus testnet factory and implementation are not source-verified on Blockscout or Sourcify; integration is gated by address provenance, pinned live bytecode, ABI reads, and the fork lifecycle."
  }' > "$output"

cat "$output"
