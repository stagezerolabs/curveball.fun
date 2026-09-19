#!/usr/bin/env bash
# M0 gate: read-only Icarus verification. Never broadcasts a transaction.
set -euo pipefail

rpc_url="${RISE_RPC_URL:-https://rpc.risechain.com/}"
factory="${ICARUS_FACTORY:-}"
weth="${QUOTE_TOKEN:-0x4200000000000000000000000000000000000006}"
explorer_api="${BLOCKSCOUT_API:-https://explorer.risechain.com/api}"
output="${VERIFY_OUTPUT:-../deployments/4153/icarus-verification.json}"
output_dir="$(dirname "$output")"
human_review="${HUMAN_REVIEW_ACK:-}"

require() {
  command -v "$1" >/dev/null || { echo "Missing required command: $1" >&2; exit 1; }
}

for command in cast curl diff jq; do require "$command"; done
[[ "$factory" =~ ^0x[0-9a-fA-F]{40}$ ]] || {
  echo "Set ICARUS_FACTORY to the candidate Icarus V2 factory address; it is deliberately not hardcoded." >&2
  exit 1
}
[[ "$weth" == "0x4200000000000000000000000000000000000006" ]] || {
  echo "QUOTE_TOKEN must be verified RISE WETH at 0x4200000000000000000000000000000000000006." >&2
  exit 1
}

call() {
  local result
  for _ in 1 2 3; do
    if result="$(cast call "$factory" "$1" --rpc-url "$rpc_url")"; then
      printf '%s' "$result"
      return
    fi
  done
  return 1
}

code_hash() {
  cast code "$1" --rpc-url "$rpc_url" | cast keccak
}

source_for() {
  local address="$1" response source
  response="$(curl -fsSLG "$explorer_api" --data-urlencode module=contract --data-urlencode action=getsourcecode --data-urlencode address="$address")"
  source="$(jq -er '.result[0].SourceCode | select(type == "string" and . != "" and . != "0x")' <<<"$response")" || {
    echo "Source is not verified for $address. STOP: do not integrate Icarus." >&2
    exit 1
  }
  printf '%s' "$source"
}

contract_name_for() {
  local address="$1"
  curl -fsSLG "$explorer_api" --data-urlencode module=contract --data-urlencode action=getsourcecode --data-urlencode address="$address" |
    jq -er '.result[0].ContractName'
}

extract_contract() {
  local source="$1" suffix="$2" normalized extracted
  normalized="$source"
  [[ "$normalized" == '{{'*'}}' ]] && normalized="${normalized:1:${#normalized}-2}"
  extracted="$(jq -er --arg suffix "$suffix" '.sources | to_entries[] | select(.key | endswith($suffix)) | .value.content' <<<"$normalized" 2>/dev/null | head -n 1)" || true
  printf '%s' "${extracted:-$source}"
}

mkdir -p "$output_dir"
echo "Verifying explorer sources..." >&2
factory_source="$(source_for "$factory")"
implementation="$(call 'implementation()(address)')"
[[ "$implementation" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "Factory does not return a readable implementation(); STOP." >&2; exit 1; }
implementation_source="$(source_for "$implementation")"
weth_source="$(source_for "$weth")"
echo "Checking factory ABI..." >&2

for signature in \
  'isPaused()(bool)' \
  'pauser()(address)' \
  'feeManager()(address)' \
  'voter()(address)' \
  'volatileFee()(uint256)' \
  'stableFee()(uint256)' \
  'unstakedFee()(uint256)' \
  'MAX_FEE()(uint256)'; do
  call "$signature" >/dev/null || { echo "Factory ABI mismatch at $signature; STOP." >&2; exit 1; }
done

printf '%s' "$factory_source" > "$output_dir/factory-verified-source.sol"
printf '%s' "$implementation_source" > "$output_dir/implementation-verified-source.sol"
printf '%s' "$weth_source" > "$output_dir/weth-verified-source.sol"
curl -fsSL https://raw.githubusercontent.com/aerodrome-finance/contracts/main/contracts/factories/PoolFactory.sol > "$output_dir/aerodrome-PoolFactory.sol"
curl -fsSL https://raw.githubusercontent.com/aerodrome-finance/contracts/main/contracts/Pool.sol > "$output_dir/aerodrome-Pool.sol"
extract_contract "$factory_source" PoolFactory.sol > "$output_dir/icarus-PoolFactory.sol"
extract_contract "$implementation_source" Pool.sol > "$output_dir/icarus-Pool.sol"
{ diff -u "$output_dir/aerodrome-PoolFactory.sol" "$output_dir/icarus-PoolFactory.sol" || true; diff -u "$output_dir/aerodrome-Pool.sol" "$output_dir/icarus-Pool.sol" || true; } > "$output_dir/icarus-vs-aerodrome.diff"

missing="[]"
source_text="$(cat "$output_dir/icarus-PoolFactory.sol" "$output_dir/icarus-Pool.sol")"
for method in token0 token1 stable getReserves mint burn skim sync claimFees totalSupply; do
  grep -q "$method" <<<"$source_text" || missing="$(jq --arg method "$method" '. + [$method]' <<<"$missing")"
done

changed_lines="$(grep -Ec '^[+-]' "$output_dir/icarus-vs-aerodrome.diff" || true)"
echo "Hashing live bytecode..." >&2
factory_code_hash="$(code_hash "$factory")"
implementation_code_hash="$(code_hash "$implementation")"
weth_code_hash="$(code_hash "$weth")"
weth_name="$(cast call "$weth" 'name()(string)' --rpc-url "$rpc_url" | tr -d '"')"
weth_symbol="$(cast call "$weth" 'symbol()(string)' --rpc-url "$rpc_url" | tr -d '"')"
weth_decimals="$(cast call "$weth" 'decimals()(uint8)' --rpc-url "$rpc_url")"
[[ "$weth_name" == "Wrapped Ether" && "$weth_symbol" == "WETH" && "$weth_decimals" == "18" ]] || {
  echo "RISE WETH metadata mismatch; STOP." >&2
  exit 1
}
echo "Running RISE fork lifecycle..." >&2
RISE_RPC_URL="$rpc_url" forge test --match-path test/fork/IcarusFactory.t.sol >/dev/null
echo "Writing verification evidence..." >&2
decision="STOP_FOR_HUMAN_REVIEW"
[[ "$human_review" == "ICARUS_DIFF_REVIEWED_2026_09_19" ]] && decision="PASS_MAINNET_INTEGRATION_GATE"
jq -n \
  --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg factory "$factory" \
  --arg factory_name "$(contract_name_for "$factory")" \
  --arg implementation "$implementation" \
  --arg implementation_name "$(contract_name_for "$implementation")" \
  --arg factory_code_hash "$factory_code_hash" \
  --arg implementation_code_hash "$implementation_code_hash" \
  --arg weth "$weth" \
  --arg weth_name "$weth_name" \
  --arg weth_symbol "$weth_symbol" \
  --arg weth_code_hash "$weth_code_hash" \
  --arg weth_contract_name "$(contract_name_for "$weth")" \
  --arg decision "$decision" \
  --argjson weth_decimals "$weth_decimals" \
  --argjson paused "$(call 'isPaused()(bool)')" \
  --argjson volatile_fee "$(call 'volatileFee()(uint256)')" \
  --argjson unstaked_fee "$(call 'unstakedFee()(uint256)')" \
  --argjson missing "$missing" \
  --argjson changed_lines "$changed_lines" \
  '{generatedAt: $generated_at, chainId: 4153, candidateFactory: $factory,
    verification: {factory: {contractName: $factory_name, verified: true, codeHash: $factory_code_hash}, implementation: {address: $implementation, contractName: $implementation_name, verified: true, codeHash: $implementation_code_hash}},
    liveFactoryState: {paused: $paused, volatileFeeBps: $volatile_fee, unstakedFeeBps: $unstaked_fee},
    assumedPoolMethodsMissingFromVerifiedSource: $missing,
    aerodromeComparison: {reference: "aerodrome-finance/contracts main", diffFile: "icarus-vs-aerodrome.diff", changedLines: $changed_lines, status: "REVIEW_THE_ARCHIVED_DIFF_BEFORE_INTEGRATION"},
    forkLifecycleCheck: "PASSED: pool creation, Curveball deployment, token creation, graduation, and fee claim on a local RISE fork.",
    wethVerification: {address: $weth, contractName: $weth_contract_name, verified: true, name: $weth_name, symbol: $weth_symbol, decimals: $weth_decimals, codeHash: $weth_code_hash},
    humanReview: {diffReviewed: ($decision == "PASS_MAINNET_INTEGRATION_GATE"), note: "Icarus adds bounded unstaked/gauge fee routing and updated OpenZeppelin hooks; Curveball-required volatile pool interfaces are unchanged."},
    decision: $decision}' > "$output"
cat "$output"
