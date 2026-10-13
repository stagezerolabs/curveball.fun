#!/usr/bin/env bash
set -euo pipefail

readonly chain_id=11155931
readonly factory=0xD0f0cf4fd5Aa9D391477B3B9CF3B77Dc96705056
readonly expected_owner=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3
readonly target_fee=75
readonly confirmation_phrase=SET_CURVEBALL_FEE_75_BPS_RISE_TESTNET_11155931
readonly rpc_url="${TESTNET_RPC_URL:-https://testnet.riselabs.xyz}"
readonly signer_account="${ACCOUNT:-dot}"
readonly check_only="${1:-}"

if [[ -n "$check_only" && "$check_only" != "--check" ]]; then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi
if [[ "$check_only" != "--check" && ! -t 0 ]]; then
  echo "Run this command in an interactive terminal." >&2
  exit 2
fi
if [[ "$(cast chain-id --rpc-url "$rpc_url")" != "$chain_id" ]]; then
  echo "RPC is not RISE Testnet (${chain_id})." >&2
  exit 2
fi

read_factory() {
  cast call --rpc-url "$rpc_url" "$factory" "$1"
}

lowercase() {
  printf '%s' "$1" | tr '[:upper:]' '[:lower:]'
}

owner="$(read_factory 'owner()(address)')"
fee="$(read_factory 'feeBps()(uint16)')"
creator_share="$(read_factory 'creatorShareBps()(uint16)')"
buyback_share="$(read_factory 'buybackShareBps()(uint16)')"
tax_cap="$(read_factory 'creatorTaxCapBps()(uint16)')"
treasury="$(read_factory 'treasury()(address)')"
pending_owner="$(read_factory 'pendingOwner()(address)')"

printf 'Chain: %s\nFactory: %s\nOwner: %s\nCurrent trading fee: %s bps\nTarget trading fee: %s bps\nCreator share: %s bps\nBuyback share: %s bps\nCreator tax cap: %s bps\nTreasury: %s\nPending owner: %s\n' \
  "$chain_id" "$factory" "$owner" "$fee" "$target_fee" "$creator_share" "$buyback_share" "$tax_cap" "$treasury" "$pending_owner"

if [[ "$fee" == "$target_fee" ]]; then
  echo "The factory trading fee is already 75 bps. No transaction is needed."
  exit 0
fi
if [[ "$(lowercase "$owner")" != "$(lowercase "$expected_owner")" ]]; then
  echo "Factory owner differs from the expected dot wallet; refusing the update." >&2
  exit 2
fi
if [[ "$fee" != 50 ]]; then
  echo "Expected the current fee to be 50 bps; refusing to overwrite an unexpected value." >&2
  exit 2
fi
if [[ "$(lowercase "$pending_owner")" != 0x0000000000000000000000000000000000000000 ]]; then
  echo "An ownership transfer is pending; refusing the update." >&2
  exit 2
fi

# Eth_call checks the exact setter arguments against the live contract without sending.
cast call --rpc-url "$rpc_url" --from "$owner" "$factory" \
  'setFeeDefaults(uint16,uint16,uint16,uint16,address)' \
  "$target_fee" "$creator_share" "$buyback_share" "$tax_cap" "$treasury" >/dev/null
echo "Read-only fee update simulation succeeded."

if [[ "$check_only" == "--check" ]]; then
  echo "Check complete. No transaction was sent."
  exit 0
fi
if ! cast wallet list | rg -q "^${signer_account} \(Local\)$"; then
  echo "Local Foundry account '${signer_account}' was not found." >&2
  exit 2
fi

printf 'Type %s to send the fee update: ' "$confirmation_phrase"
read -r confirmation
if [[ "$confirmation" != "$confirmation_phrase" ]]; then
  echo "Fee update cancelled."
  exit 2
fi

# Catch a fee, owner, or companion-setting change after the first read.
[[ "$(read_factory 'owner()(address)')" == "$owner" && \
   "$(read_factory 'feeBps()(uint16)')" == "$fee" && \
   "$(read_factory 'creatorShareBps()(uint16)')" == "$creator_share" && \
   "$(read_factory 'buybackShareBps()(uint16)')" == "$buyback_share" && \
   "$(read_factory 'creatorTaxCapBps()(uint16)')" == "$tax_cap" && \
   "$(read_factory 'treasury()(address)')" == "$treasury" && \
   "$(read_factory 'pendingOwner()(address)')" == "$pending_owner" ]] || {
  echo "Factory settings changed during confirmation; refusing the update." >&2
  exit 2
}

cast send --rpc-url "$rpc_url" --chain "$chain_id" --account "$signer_account" --from "$owner" \
  "$factory" 'setFeeDefaults(uint16,uint16,uint16,uint16,address)' \
  "$target_fee" "$creator_share" "$buyback_share" "$tax_cap" "$treasury"

[[ "$(read_factory 'feeBps()(uint16)')" == "$target_fee" && \
   "$(read_factory 'creatorShareBps()(uint16)')" == "$creator_share" && \
   "$(read_factory 'buybackShareBps()(uint16)')" == "$buyback_share" && \
   "$(read_factory 'creatorTaxCapBps()(uint16)')" == "$tax_cap" && \
   "$(read_factory 'treasury()(address)')" == "$treasury" ]] || {
  echo "Transaction returned, but factory settings did not match the expected values. Inspect the receipt." >&2
  exit 1
}
echo "Confirmed: factory trading fee is 75 bps (0.75%); companion settings are unchanged."
