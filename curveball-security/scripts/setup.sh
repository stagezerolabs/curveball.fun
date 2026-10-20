#!/usr/bin/env bash
# Curveball security review: prepare the tools the review needs.
#
# Deliberately non-fatal. A missing optional tool narrows the review but should never
# block it — the agent should report the gap, not die on it.
set -u

say() { printf '[curveball-security] %s\n' "$*"; }

have() { command -v "$1" >/dev/null 2>&1; }

for tool in forge cast anvil node; do
  if have "$tool"; then
    say "found $tool"
  else
    say "MISSING $tool — contract build and on-chain checks unavailable"
  fi
done

for tool in slither echidna medusa; do
  if have "$tool"; then
    say "found $tool (optional static/fuzz tooling)"
  else
    say "optional tool absent: $tool"
  fi
done

# The contracts workspace depends on solady and forge-std. They are frequently absent
# from node_modules after a partial install, which makes `forge build` fail before the
# review starts. Repair it here so the first real command is not a confusing compile error.
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [ -f "$repo_root/package.json" ] && have bun; then
  if [ ! -f "$repo_root/contracts/node_modules/solady/src/tokens/ERC20.sol" ]; then
    say "contract deps incomplete; running bun install"
    (cd "$repo_root" && bun install --silent) || say "bun install failed; contract build may not work"
  fi
fi

say "setup complete"
