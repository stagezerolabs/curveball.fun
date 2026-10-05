# Curveball V2 RISE Testnet cutover

The V2 factory was deployed at `0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf` in block `55636468`. All nine contracts are source-verified on Blockscout and the on-chain addresses and receipts are captured in `deployments/11155931/curveball-v2.json`. The V1 app configuration remains active until the separately approved database migration and app cutover. Do not reuse `0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E` as a V2 factory.

## Preflight

1. Run `make -C contracts test`, `make -C contracts test-fork-strict RISE_TESTNET_RPC_URL=https://testnet.riselabs.xyz`, `bun run test:integration:sdk`, `bun run typecheck`, `bun run build`, and the PostgreSQL integration gate against an isolated database.
2. Run `make -C contracts verify-icarus-testnet` and `make -C contracts simulate-v2-testnet RISE_TESTNET_RPC_URL=https://testnet.riselabs.xyz TREASURY=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3`. The latter is a simulation; its returned factory address is **not** a deployment record.
3. Inspect the final diff and obtain approval for the exact broadcast command below before any broadcast. The guarded target requires an interactive terminal, the encrypted `dot` keystore, `CONFIRM_V2_TESTNET=DEPLOY_CURVEBALL_V2_RISE_TESTNET_11155931`, `TREASURY`, `BLOCKSCOUT_API`, and the testnet RPC. No private key belongs in a command or file.

## Broadcast and record

The approved broadcast command must exactly match the command eventually executed. The target is `make -C contracts deploy-v2-testnet RISE_TESTNET_RPC_URL=https://testnet.riselabs.xyz TREASURY=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3 BLOCKSCOUT_API=https://explorer.testnet.riselabs.xyz/api CONFIRM_V2_TESTNET=DEPLOY_CURVEBALL_V2_RISE_TESTNET_11155931`.

After receipts are final, `CONFIRM_RECORD_V2=RECORD_CURVEBALL_V2_RISE_TESTNET_11155931 RISE_TESTNET_RPC_URL=https://testnet.riselabs.xyz bun run record:v2:testnet` validates the factory and all eight services on chain and writes `deployments/11155931/curveball-v2.json`. Compare its code hashes and block with receipts and Blockscout verification.

The September 29 broadcast succeeded, but Forge's transaction array attached several creation hashes to the wrong service names. The recorder matches successful receipts by deployed address and verifies each receipt against the live chain. Initial Blockscout verification also paired those wrong names and addresses; all nine correct address/source pairs were subsequently verified individually.

## Data and app cutover

1. Review `drizzle/0003_orange_the_twelve.sql`, then obtain separate exact production action approval for `CONFIRM_V2_DB_MIGRATION=MIGRATE_CURVEBALL_V2_NEON_TESTNET_11155931 bun run db:migrate:v2:testnet`. The guarded command pins the live `curveball-testnet` Neon project (`dry-dew-99165555`), `main` branch, `curveball` database, and `curveball_owner` role. It rehearses the migration against a data-copy branch using a direct connection, verifies its migration ledger and schema, creates a no-compute backup branch immediately before the target migration, then migrates and verifies the testnet target. It leaves both branches in place for inspection. The new nullable deployment and curve columns preserve legacy rows; the V2 API filters by factory address and uses a separate indexer cursor.

   Completed September 30: migration 0003 is applied on the testnet target. The independent ledger check found four entries with final hash `2ba1d120c0ae5c2f7921ddc39257b06d8f5e7c9790135290e1c569315c0d64c1`; the V2 columns and event indexes exist. Recovery branch: `v2-pre-migration-20260930` (`br-shiny-mountain-b5g9lh38`). Rehearsal branch: `v2-migration-rehearsal-20260930` (`br-tiny-field-b5qmqv52`). Do not rerun the one-shot migration command on this already migrated target.
2. Set `CONTRACT_VERSION=v2`, `LAUNCHPAD_ADDRESS=<recorded V2 factory>`, and `INDEXER_START_BLOCK=<recorded deployment block>` on the API/indexer. Set `VITE_CONTRACT_VERSION=v2`, `VITE_LAUNCHPAD_ADDRESS=<same factory>`, and `VITE_DEPLOYMENT_BLOCK=<same block>` in the web build. Keep the RPC and chain ID on RISE Testnet.
3. Check `/api/health` reports `contractVersion: "v2"` and the recorded factory. Check `/api/config` returns the quote, locker, escrow, vault, and three-way fee policy. Launch a small test token, confirm it appears in `/api/tokens`, make buy and sell trades, and compare indexer entries against `LaunchCreated`, curve `Trade`, and escrow `FeeAccrued` logs.
4. Exercise graduation and an Icarus swap, claim LP fees through the V2 locker, and verify `FeeClaimed`/`BuybackExecuted` indexing. Confirm the creator can claim both quote and in-kind token fees and that the recorded LP remains in the locker.

If chain, factory, version, or service validation fails, leave the V1 configuration active. V2 is never selected by a missing environment variable. The unfinished Cloudflare Worker adapter remains a separate migration and must not be pointed at V2 without its own API/indexer parity test.
