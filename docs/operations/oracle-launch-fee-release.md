# Oracle launch fee release

The new launchpad charges WETH worth 1 USDC at the Stork ETH/USDC price. It requires a sample at most 60 seconds old, a price between 100 and 100,000 USDC per ETH, and a fee no greater than 0.01 WETH. The creator supplies a maximum WETH fee; a higher fee reverts before payment. ETH/USDC is an approximate dollar reference because this release has no USDC/USD depeg guard.

The existing mainnet launchpad at `0xCD07f89C29E1FAE77EC1a342b5D47D9008E9a72d` remains live for its markets. It can still accept direct launches at its old fee while its buys are enabled. Pausing that contract would also stop buys, so do not pause it as part of the fee migration.

The older testnet contract emits a different launch and trade event shape. Use the oracle testnet targets to deploy, record, and smoke test v3. Run any testnet app preview against an isolated database; `activate-testnet-oracle` intentionally refuses to reuse existing testnet projections.

## Before broadcasting

1. Commit the contract source and run `make test`, `make -C contracts test-fork-strict`, and `make -C contracts test-fork-testnet`. Use a private HTTPS `RISE_MAINNET_RPC_URL` and the pinned `MAINNET_ACCOUNT=curveball` keystore in the ignored root `.env`. Check the current Stork ETH/USDC sample and Stork proxy code at `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62`.
2. Run `make production-oracle-preflight`. This includes a nonbroadcasting deployment script, canonical Icarus verification, and strict mainnet fork tests. The old `deploy-production` target cannot release v3 because the v2 record already exists.
3. Obtain an independent review of the fee arithmetic, Stork interface, stale-price behavior, fee cap, and legacy market migration. Save a database and config backup before activating the new app.

## Deploy and record

1. Run `make deploy-production-oracle CONFIRM_DEPLOY=DEPLOY_CURVEBALL_ORACLE_RISE_MAINNET_4153` with the pinned Foundry keystore. The script deploys a new timelock, escrow, buyback treasury, locker, token implementation, and launchpad. It does not modify the old contracts.
2. Wait for Blockscout source verification, then run `CONFIRM_RECORD_PRODUCTION=RECORD_CURVEBALL_RISE_MAINNET_4153 make record-production-oracle`. This writes `deployments/4153/curveball-oracle-v3.json` without overwriting the v2 record. The recorder checks the live quote, oracle address, onchain policy, authority, runtime bytecode, and source verification.
3. Run `make deploy-icarus-swap-oracle-mainnet CONFIRM_ICARUS_SWAP_DEPLOY=DEPLOY_ICARUS_SWAP_ORACLE_RISE_MAINNET_4153`, then `make record-icarus-swap-oracle-mainnet`. The adapter is bound to the new launchpad; the legacy adapter remains bound to the old one.
4. Run `make configure-production-oracle`. Inspect the resulting tracked `.env.production` and ignored mainnet service env files. Their new primary launchpad must match v3; their legacy registry must match the v2 record. Never put signer keys in a `VITE_` variable.

## Activate and verify

1. Prepare production env files with `bun deploy/prepare-production-env.mjs --network mainnet`. The script validates both deployment and adapter records and refuses to overwrite existing target env files. Follow `deploy/README.md` and `.codex/DEPLOYMENT.md` for the VPS backup and release flow. Build the frontend with `VITE_LAUNCH_FEE_MODE=oracle`; start the backend with `SOCIAL_LAUNCH_FEE_MODE=oracle` and `SOCIAL_LEGACY_LAUNCHPADS=<old address>:<old block>`.
2. Ensure the backend has indexed the v2 market before and after the release. Check the old market page, buy/sell quote, claims, API `factoryAddress`, and indexer cursor freshness. Check that the new launch page displays the fee quote, price age, fee cap, and total maximum WETH spend. An unavailable or stale Stork quote must disable launching while old market trading remains available.
3. Run a small live launch, then inspect `LaunchFeePaid`, treasury WETH receipt, the new market's API factory, and a trade. Verify the fee equals `ceil(1e36 / priceX18)` wei and is no greater than the submitted cap. Verify the old market still trades. Monitor quote failures, feed age, failed launches, indexer lag, and keeper actions.

Rollback of the web or API release restores the prior app and env files and leaves both contract records intact. Do not delete market projections. The old public contract remains available onchain; the new contract cannot be undeployed. A stale Stork feed safely prevents v3 launches until the feed recovers.
