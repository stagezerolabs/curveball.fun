#!/usr/bin/env bash
# M0 gate: read-only Icarus verification. Never broadcasts a transaction.
set -euo pipefail

rpc_url="${RISE_RPC_URL:-https://rpc.risechain.com/}"
factory="${ICARUS_FACTORY:-}"
explorer_api="${BLOCKSCOUT_API:-https://explorer.risechain.com/api}"
output="${VERIFY_OUTPUT:-../deployments/4153/icarus-verification.json}"
output_dir="$(dirname "$output")"

require() {
  command -v "$1" >/dev/null || { echo "Missing required command: $1" >&2; exit 1; }
}

for command in cast curl diff jq; do require "$command"; done
[[ "$factory" =~ ^0x[0-9a-fA-F]{40}$ ]] || {
  echo "Set ICARUS_FACTORY to the candidate Icarus V2 factory address; it is deliberately not hardcoded." >&2
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
factory_source="$(source_for "$factory")"
implementation="$(call 'implementation()(address)')"
[[ "$implementation" =~ ^0x[0-9a-fA-F]{40}$ ]] || { echo "Factory does not return a readable implementation(); STOP." >&2; exit 1; }
implementation_source="$(source_for "$implementation")"

for signature in \
  'isPaused()(bool)' \
  'pauser()(address)' \
  'feeManager()(address)' \
  'voter()(address)' \
  'volatileFee()(uint256)' \
  'stableFee()(uint256)' \
  'MAX_FEE()(uint256)'; do
  call "$signature" >/dev/null || { echo "Factory ABI mismatch at $signature; STOP." >&2; exit 1; }
done

printf '%s' "$factory_source" > "$output_dir/factory-verified-source.sol"
printf '%s' "$implementation_source" > "$output_dir/implementation-verified-source.sol"
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
jq -n \
  --arg generated_at "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg factory "$factory" \
  --arg rpc_url "$rpc_url" \
  --arg factory_name "$(contract_name_for "$factory")" \
  --arg implementation "$implementation" \
  --arg implementation_name "$(contract_name_for "$implementation")" \
  --argjson missing "$missing" \
  --argjson changed_lines "$changed_lines" \
  '{generatedAt: $generated_at, chainId: 4153, candidateFactory: $factory, rpcUrl: $rpc_url,
    verification: {factory: {contractName: $factory_name, verified: true}, implementation: {address: $implementation, contractName: $implementation_name, verified: true}},
    assumedPoolMethodsMissingFromVerifiedSource: $missing,
    aerodromeComparison: {reference: "aerodrome-finance/contracts main", diffFile: "icarus-vs-aerodrome.diff", changedLines: $changed_lines, status: "REVIEW_THE_ARCHIVED_DIFF_BEFORE_INTEGRATION"},
    forkCreatePoolCheck: "NOT_RUN. Run only on a local fork with two freshly deployed throwaway ERC20s; this script intentionally never sends a mainnet transaction.",
    wethVerification: "NOT_RUN. Identify WETH by inspecting verified token contracts and live Icarus pools; never assume an OP-stack predeploy.",
    decision: "STOP_FOR_HUMAN_REVIEW"}' > "$output"
cat "$output"
