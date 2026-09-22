#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
codex_dir="/Users/macbook/.codex"
profile="$script_dir/curveball-quality-gates.json"
profile_sha="$(shasum -a 256 "$profile" | awk '{print $1}')"

install -d "$codex_dir/hooks" "$codex_dir/agents" "$codex_dir/quality-profiles" "$repo_root/.codex"
install -m 0755 "$script_dir/quality_gate.py" "$codex_dir/hooks/quality_gate.py"
/usr/bin/python3 "$script_dir/install_hooks.py" "$script_dir/hooks.json" "$codex_dir/hooks.json"
install -m 0644 "$script_dir/quality-reviewer.toml" "$codex_dir/agents/quality_reviewer.toml"
install -m 0644 "$script_dir/AGENTS.global.md" "$codex_dir/AGENTS.md"
install -m 0644 "$profile" "$repo_root/.codex/quality-gates.json"
install -m 0644 "$script_dir/curveball-profile-root.txt" "$codex_dir/quality-profiles/$profile_sha"

echo "Installed Codex quality gates globally and for $repo_root"
