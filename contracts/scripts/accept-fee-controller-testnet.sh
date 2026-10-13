#!/usr/bin/env bash
set -euo pipefail

readonly chain_id=11155931
readonly factory=0xD0f0cf4fd5Aa9D391477B3B9CF3B77Dc96705056
readonly dot=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3
readonly fee_admin=0x5cc42e772f67089b4670eec4dcd904be2f2d511c
readonly rpc_url="${TESTNET_RPC_URL:-https://testnet.riselabs.xyz}"
readonly signer_account="${ACCOUNT:-dot}"
readonly controller="${CONTROLLER:-}"
readonly check_only="${1:-}"
readonly expected_code_hash=0xf0accc08a30448e487f7a6a4543226c9bd57517949693b4eb7936570007dc766

if [[ -n "$check_only" && "$check_only" != "--check" ]]; then echo "Usage: $0 [--check]" >&2; exit 2; fi
if [[ "$check_only" != "--check" && ! -t 0 ]]; then echo "Run this command in an interactive terminal." >&2; exit 2; fi
if [[ ! "$controller" =~ ^0x[0-9a-fA-F]{40}$ ]]; then echo "Set CONTROLLER to the deployed controller address." >&2; exit 2; fi
if [[ "$(cast chain-id --rpc-url "$rpc_url")" != "$chain_id" ]]; then echo "RPC is not RISE Testnet." >&2; exit 2; fi

lowercase() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
read_factory() { cast call --rpc-url "$rpc_url" "$factory" "$1"; }
read_controller() { cast call --rpc-url "$rpc_url" "$controller" "$1"; }

owner="$(read_factory 'owner()(address)')"
pending="$(read_factory 'pendingOwner()(address)')"
bound_factory="$(read_controller 'factory()(address)')"
super_admin="$(read_controller 'owner()(address)')"
delegate="$(read_controller 'feeAdmin()(address)')"
fee="$(read_factory 'feeBps()(uint16)')"
code_hash="$(cast codehash --rpc-url "$rpc_url" "$controller")"
printf 'Factory owner: %s\nPending owner: %s\nController: %s\nController super admin: %s\nFee admin: %s\nTrading fee: %s bps\n' \
  "$owner" "$pending" "$controller" "$super_admin" "$delegate" "$fee"

if [[ "$(lowercase "$code_hash")" != "$expected_code_hash" || \
      "$(lowercase "$bound_factory")" != "$(lowercase "$factory")" || \
      "$(lowercase "$super_admin")" != "$(lowercase "$dot")" || \
      "$(lowercase "$delegate")" != "$(lowercase "$fee_admin")" || "$fee" != 75 ]]; then
  echo "Controller or fee does not match the expected handoff." >&2
  exit 2
fi
if [[ "$(lowercase "$owner")" == "$(lowercase "$controller")" ]]; then echo "Controller already owns the factory. No transaction is needed."; exit 0; fi
if [[ "$(lowercase "$owner")" != "$(lowercase "$fee_admin")" || \
      "$(lowercase "$pending")" != "$(lowercase "$controller")" ]]; then
  echo "Factory ownership does not match the expected pending handoff." >&2
  exit 2
fi

cast call --rpc-url "$rpc_url" --from "$dot" "$controller" 'acceptFactoryOwnership()' >/dev/null
echo "Read-only ownership acceptance simulation succeeded."
if [[ "$check_only" == "--check" ]]; then echo "Check complete. No transaction was sent."; exit 0; fi
if ! cast wallet list | rg -q "^${signer_account} \(Local\)$"; then echo "Local Foundry account '${signer_account}' was not found." >&2; exit 2; fi
printf 'Type ACCEPT_DOT_SUPER_ADMIN_FEE_CONTROLLER_11155931 to accept ownership: '
read -r confirmation
if [[ "$confirmation" != ACCEPT_DOT_SUPER_ADMIN_FEE_CONTROLLER_11155931 ]]; then echo "Acceptance cancelled."; exit 2; fi
if [[ "$(lowercase "$(read_factory 'owner()(address)')")" != "$(lowercase "$owner")" || \
      "$(lowercase "$(read_factory 'pendingOwner()(address)')")" != "$(lowercase "$pending")" ]]; then
  echo "Factory ownership changed during confirmation." >&2
  exit 2
fi
cast send --rpc-url "$rpc_url" --chain "$chain_id" --account "$signer_account" --from "$dot" "$controller" 'acceptFactoryOwnership()'
if [[ "$(lowercase "$(read_factory 'owner()(address)')")" != "$(lowercase "$controller")" ]]; then
  echo "Transaction returned, but controller is not factory owner. Inspect the receipt." >&2
  exit 1
fi
echo "Controller owns the factory. Dot is super admin; the designated wallet can edit the trading fee."
