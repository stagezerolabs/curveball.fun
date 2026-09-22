#!/usr/bin/env python3
"""Merge managed quality hooks without discarding unrelated user hooks."""

import json
import os
import shutil
import sys
from pathlib import Path


MANAGED_MARKER = "/Users/macbook/.codex/hooks/quality_gate.py"


def managed(group):
    return MANAGED_MARKER in json.dumps(group, sort_keys=True)


def merge(source, existing):
    merged = dict(existing)
    merged.setdefault("description", source.get("description", ""))
    merged_hooks = dict(existing.get("hooks", {}))
    for event, source_groups in source.get("hooks", {}).items():
        preserved = [group for group in merged_hooks.get(event, []) if not managed(group)]
        merged_hooks[event] = preserved + source_groups
    merged["hooks"] = merged_hooks
    return merged


def main():
    if len(sys.argv) != 3:
        raise SystemExit("usage: install_hooks.py <source> <destination>")
    source_path = Path(sys.argv[1])
    destination = Path(sys.argv[2])
    source = json.loads(source_path.read_text())
    existing = json.loads(destination.read_text()) if destination.is_file() else {}
    backup = destination.with_name(destination.name + ".pre-quality")
    if destination.is_file() and not backup.exists():
        shutil.copy2(destination, backup)
    output = merge(source, existing)
    temporary = destination.with_name(destination.name + ".%s.tmp" % os.getpid())
    temporary.write_text(json.dumps(output, indent=2) + "\n")
    os.chmod(temporary, 0o600)
    temporary.replace(destination)


if __name__ == "__main__":
    main()
