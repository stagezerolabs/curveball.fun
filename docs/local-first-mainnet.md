# CURVE local-first launch preparation

This milestone prepares replacement contracts. The earlier RISE mainnet deployment under `deployments/4153/curveball.json` is archived and must never be reused for the new app. The public site continues to use the recorded RISE Testnet deployment. No new public chain transaction or hosted deployment is part of this milestone.

## New contract behavior

The new launchpad starts in invited beta mode. Only the owner can invite wallets; creation and buying require an invitation. Selling and ready-market graduation are open to anyone. `openPublicLaunch()` ends invitation checks permanently. The launchpad and LP locker use two-step ownership; each new token consults the launchpad's current owner for accidental asset recovery. Rescue on the launchpad cannot take unsold market tokens or WETH owed to sellers and graduation. Rescue on the locker cannot take registered Icarus LP. The Icarus pool is a basic volatile pool; a gauge and IRS emissions are separate governance decisions.

With 1,000,000 CURVE total supply, 800,000 CURVE on the curve, and 10 WETH initial virtual quote, a full curve needs about 40 WETH of net buys. The locker splits claimed pool fees 50/50 between creator and treasury.

## Local configuration

Use a separate local Postgres database per chain. `DATABASE_URL` belongs to testnet or local Anvil; a mainnet API/indexer with `EXPECTED_CHAIN_ID=4153` must set `MAINNET_DATABASE_URL` to a distinct URL. Each indexer cursor is keyed by chain ID and launchpad address, so it cannot resume a testnet cursor on mainnet. A mainnet browser build requires `VITE_CHAIN_ID=4153`, `VITE_RPC_URL`, `VITE_LAUNCHPAD_ADDRESS`, and `VITE_DEPLOYMENT_BLOCK`. Until the new mainnet deployment has a verified receipt, keep those values unset and the public app on testnet.

The Compose `mainnet` profile starts a second Postgres service and volume. For a localhost fork stack, start it with `docker compose -f compose.yaml -f compose.dev.yaml --profile mainnet up -d postgres_mainnet`; port `5434` exposes this isolated database. The default Postgres service remains on port `5433`. Set `DOCKER_EXPECTED_CHAIN_ID=4153` only with the new v2 launchpad address and the mainnet profile running. The Vite development proxy targets the local Hono API at `127.0.0.1:3001`; an explicit `API_URL` override is needed to use another API. The browser checks the API chain and launchpad identity before accepting indexed markets.

The default `netlify.toml` and `vercel.json` contain no API redirect. The previous testnet site's settings are preserved separately in `netlify.testnet.toml`; no automated workflow publishes either configuration during this milestone.

Deployment records are chain-specific. Keep the testnet receipt at `deployments/11155931/curveball.json`; write the new mainnet receipt only to `deployments/4153/curveball-v2.json` after the later release approval. Do not overwrite the archived `deployments/4153/curveball.json`.

## Verification gates

- `make -C contracts test RISE_RPC_URL= RISE_TESTNET_RPC_URL=` runs the isolated Foundry suite. Fork tests in this command return early without RPC input and do **not** count as fork verification.
- `make -C contracts test-mainnet-fork-strict RISE_RPC_URL=https://rpc.risechain.com/` runs the fresh mainnet fork, including live dependency checks, CURVE graduation, a swap, locked LP and fees, and a graduation failure with selling available.
- `make -C contracts test-fork-strict RISE_TESTNET_RPC_URL=https://testnet.riselabs.xyz` runs the new bytecode against a fresh RISE Testnet fork.
- `echidna echidna/CurveballProperties.sol --contract CurveballProperties --config echidna.yaml --format text` runs the curve and reserve invariants from `contracts/`.
- `bun test`, `bun run typecheck`, and `bun run build` cover the application. `bun run test:integration:db` needs `TEST_DATABASE_URL` pointing to an isolated test database. An environment-skipped test is unverified.

The 2026-09-29 read-only mainnet fork confirmed factory implementation `0xA24Bdf8ee26658c822796a30770F23c2425de966`, unpaused state, 30 bps volatile fee, and the code hashes pinned in `DeployMainnet.s.sol`. Blockscout's source API returned verified `PoolFactory` and `Pool` source. Recheck these immediately before any actual deployment; live contracts take precedence over this record.

## Later release

Before beta, obtain an external security review suited to public funds, verify new source and bytecode, transfer both ownerships to a multisig and confirm acceptance, and verify rescue limits on-chain. The multisig treasury must be supplied to the mainnet deployment script. Create CURVE with durable metadata through the new launchpad under a separate transaction approval. Let real demand drive graduation; do not buy roughly 40 WETH solely to force it. Hosting requires an isolated mainnet database, one always-on indexer with reorg handling, production RPC and monitoring, then end-to-end wallet and trading checks. Opening public access is an independent irreversible transaction and approval.
