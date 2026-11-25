#!/usr/bin/env python3
"""Update the VPS's existing env files from verified oracle records without touching secrets."""
import argparse
import json
import os
import re
import stat
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
HASH = re.compile(r"^0x[0-9a-fA-F]{64}$")
STORK = "0xacc0a0cf13571d30b4b8637996f5d6d774d4fd62"
FEED = "0x7965e1bfc07a34caf0c3aa8146b200264fbb7a0eb85b1d3b1fdceecffd736b02"
OBSOLETE = re.compile(r"^(?:VITE_LAUNCH_FEE_MODE|SOCIAL_LAUNCH_FEE_MODE|VITE_LEGACY_[A-Z_]+|SOCIAL_LEGACY_LAUNCHPADS|KEEPER_LEGACY_LAUNCHPADS|VITE_FACTORY_VERSION)=")


def load_records(root):
    record = json.loads((root / "deployments/4153/curveball-oracle-v3.json").read_text())
    swap = json.loads((root / "deployments/4153/icarus-swap-adapter-oracle-v3.json").read_text())
    launchpad = record.get("launchpad", "")
    block = str(record.get("deploymentBlock", ""))
    if (record.get("chainId") != 4153 or record.get("version") != "oracle-v3" or
        record.get("launchFeeUsd") != "1000000000000000000" or
        record.get("maxOracleAgeSeconds") != "1800" or
        str(record.get("storkOracle", "")).lower() != STORK or
        str(record.get("storkFeedId", "")).lower() != FEED or
        not ADDRESS.fullmatch(launchpad) or not re.fullmatch(r"[1-9]\d*", block)):
        raise ValueError("Invalid RISE mainnet oracle launchpad record")
    if (swap.get("chainId") != 4153 or
        str(swap.get("launchpad", "")).lower() != launchpad.lower() or
        not ADDRESS.fullmatch(str(swap.get("adapter", ""))) or
        not HASH.fullmatch(str(swap.get("codeHash", "")))):
        raise ValueError("Swap adapter record does not match the oracle launchpad")
    return record, swap


def read_env(path):
    if not path.is_file():
        raise ValueError(f"Missing {path}")
    lines = path.read_text().splitlines()
    values = {}
    for line in lines:
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return lines, values


def require_env(path, expected):
    _, values = read_env(path)
    for key, value in expected.items():
        if values.get(key, "").lower() != str(value).lower():
            raise ValueError(f"{path}: {key} does not match the oracle record")


def write_env(path, updates):
    lines, _ = read_env(path)
    output = []
    seen = set()
    for line in lines:
        if OBSOLETE.match(line):
            continue
        key = line.split("=", 1)[0] if "=" in line else ""
        if key in updates:
            if key not in seen:
                output.append(f"{key}={updates[key]}")
                seen.add(key)
        else:
            output.append(line)
    for key, value in updates.items():
        if key not in seen:
            output.append(f"{key}={value}")
    content = "\n".join(output).rstrip("\n") + "\n"
    original = path.stat()
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, prefix=f".{path.name}.", delete=False) as temp:
        temp_path = Path(temp.name)
        os.fchmod(temp.fileno(), stat.S_IMODE(original.st_mode))
        os.fchown(temp.fileno(), original.st_uid, original.st_gid)
        temp.write(content)
        temp.flush()
        os.fsync(temp.fileno())
    os.replace(temp_path, path)


def configure(root, check=False):
    record, swap = load_records(root)
    launchpad = record["launchpad"]
    block = record["deploymentBlock"]
    frontend = {
        "VITE_CHAIN_ID": "4153", "VITE_LAUNCHPAD_ADDRESS": launchpad,
        "VITE_DEPLOYMENT_BLOCK": block, "VITE_ICARUS_SWAP_ADAPTER": swap["adapter"],
        "VITE_ICARUS_SWAP_ADAPTER_CODE_HASH": swap["codeHash"],
    }
    social = {"SOCIAL_CHAIN_ID": "4153", "SOCIAL_LAUNCHPAD_ADDRESS": launchpad, "SOCIAL_DEPLOYMENT_BLOCK": block}
    keeper = {"KEEPER_CHAIN_ID": "4153", "KEEPER_LAUNCHPAD_ADDRESS": launchpad, "KEEPER_DEPLOYMENT_BLOCK": block}
    release = f"mainnet-oracle-v3-{launchpad[2:10].lower()}"
    production = {**frontend, "CURVEBALL_RELEASE": release}
    paths = {
        root / "deploy/production.env": production,
        root / "deploy/social.env": {**social, "SENTRY_RELEASE": f"curveball-backend@{release}"},
        root / "deploy/keeper.env": {**keeper, "SENTRY_RELEASE": f"curveball-keeper@{release}"},
    }
    require_env(root / ".env.production", frontend)
    for path in paths:
        _, values = read_env(path)
        prefix = "VITE" if path.name == "production.env" else "SOCIAL" if path.name == "social.env" else "KEEPER"
        if values.get(f"{prefix}_CHAIN_ID") != "4153":
            raise ValueError(f"{path}: expected RISE mainnet chain 4153")
    read_env(root / "deploy/web.env")
    if not check:
        for path, updates in paths.items():
            write_env(path, updates)
        write_env(root / "deploy/web.env", frontend)
    for path, expected in paths.items():
        require_env(path, expected)
    return launchpad


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    parser.add_argument("--root", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        print(configure(args.root, args.check))
    except (ValueError, OSError, KeyError, json.JSONDecodeError) as error:
        parser.exit(2, f"{error}\n")
