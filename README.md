# curveball.fun

This repository is deliberately stopped at **M0: Icarus verification**. The supplied product spec requires confirmed RISE/Icarus contracts before any graduation integration, deployment, or frontend is built.

## Run the gate

```sh
bun install
cp contracts/.env.example contracts/.env
# Set ICARUS_FACTORY only after obtaining the candidate address independently.
set -a; source contracts/.env; set +a
bun run verify:icarus
```

The script refuses an unverified factory or ABI mismatch, writes evidence to `deployments/4153/icarus-verification.json`, and archives returned verified sources beside it. It never sends a transaction. Its output identifies the remaining blocking checks: line-by-line source diff, a local-fork `createPool` test with throwaway assets, and canonical RISE WETH identification.

M1 adds a local-testable launchpad that uses direct Icarus-pool minting; its real factory address is isolated from deployment inputs until fork verification can use a compatible RPC.
