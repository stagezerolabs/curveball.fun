# RISE Testnet migration handoff

Updated: 2026-09-22 WAT
Branch: `feature/rise-testnet-migration`

## Target network

- Chain ID: `11155931`
- RPC: `https://testnet.riselabs.xyz`
- Explorer: `https://explorer.testnet.riselabs.xyz`
- WETH: `0x4200000000000000000000000000000000000006`
- Icarus PoolFactory: `0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9`
- Icarus pool implementation: `0x74309f2134DA3E920094A5B0d5DF5d5Dcd1942b1`

The Icarus addresses come from the public Icarus application configuration. Blockscout and Sourcify do not have verified source for these testnet dependencies. The accepted gate is pinned bytecode, live ABI/state reads, and the complete Curveball lifecycle on a fresh fork. Evidence is in `deployments/11155931/icarus-verification.json`.

## Completed

- Added an exact-chain `DeployTestnet.s.sol` guarded by chain ID, confirmation token, canonical WETH/factory, WETH metadata, and the `dot` treasury.
- Prevented the generic deployment script from targeting RISE mainnet or RISE Testnet.
- Converted the active Icarus fork suite to RISE Testnet. Deployment wiring, pool creation, graduation, swapping, and fee claims pass.
- Migrated runtime and SDK chain validation to RISE Testnet and centralized RPC/explorer settings.
- Updated frontend explorer links and wallet-switch copy.
- Added testnet dependency verification and deployment Make targets.
- Removed active mainnet values from `.env.example`, `netlify.toml`, README, and the Koyeb runbook; all now fail closed or remain explicitly pending until the broadcast supplies the canonical address.
- Added `.dockerignore` coverage for local environment files, keystores/broadcast artifacts, dependency trees, and local deployment backups.
- Added an existing-receipt guard so `make deploy-testnet` refuses an accidental second deployment.
- Created a separate Neon project named `curveball-testnet` (`dry-dew-99165555`) and applied all Drizzle migrations. The old database was not modified.
- Created Koyeb secrets `curveball_testnet_database_url` and `curveball_testnet_rpc_url` and switched the live API service to them.
- Linked the workspace to Netlify site `curveball-fun` (`98c3e594-e664-4fc9-b8c2-e3b0e876d003`).
- Fixed Drizzle configuration so it does not append a duplicate `sslmode` parameter to Neon URLs.
- Deployed and recorded the canonical contracts at block `55002177`; both contracts are source-verified on Blockscout.
- Wired the canonical launchpad through the SDK, frontend, environment template, Netlify config, Koyeb runbook, and README.
- Deployed Koyeb API revision `72e11c3e-4bc8-4d0a-9ce7-6737bbe33e4a`; `/api/health` reports chain `11155931`.
- Deployed Netlify production revision `6ab2a14829720728c733430d`; the public bundle contains chain `11155931` and the canonical launchpad.
- Browser-smoked the public home and Launch pages. Navigation, empty-market state, wallet gate, and launch form render correctly.
- Fixed the post-confirmation launch error by retaining the submitted form before the asynchronous wallet call; a regression test reproduces React clearing `event.currentTarget` and now passes.
- Added and deployed `/profile`, a creator dashboard that reads `TokenCreated` events directly from RISE Testnet block `55002177`, independent of the sleeping indexer.
- Created `LONGNICO` (`NICO`) from wallet `0x18B99327e596d422a242F60b51979bF9d76841c2`. Token: `0x0925F36414f3e4F5604Ee05Be904307A37274c24`; transaction: `0x37acdc1a28ec8213a21e4f02ce677783104e7ce673920235e72c2ae4bbad8ca4`.
- Deployed the launch fix and creator dashboard to Netlify revision `6ab2a644c95b8c59857c46e5` and verified the connected desktop state in-browser.
- Added a connected-only Profile link to the hamburger menu.
- Added direct on-chain fallbacks for individual market routes and the shared Trending/New market feed. Netlify revision `6ab2a952299b24ade8b79546` visibly renders `SHORTDOG` and `LONGNICO`; Graduated remains empty because neither curve has graduated.

## Verification completed

- `bun test`: 36 passed, 3 environment-dependent skips, 0 failed.
- `bun run typecheck`: passed.
- `bun run build`: passed.
- Foundry suite: 26 passed, 0 failed.
- RISE Testnet fork suite: all 3 passed, including a complete graduation and fee-claim lifecycle. One full-suite run had a transient RPC TLS failure during fork creation; the affected test passed immediately on retry.
- Isolated Neon integration tests: schema/indexer concurrency and market stats passed.
- `shellcheck` for both new deployment scripts and `git diff --check`: passed.
- Deployment simulation: passed; estimated requirement was approximately `0.0000054 ETH`.
- `dot` testnet balance observed before deployment: `0.06 ETH`.

## Remaining operational work

1. Authorize a paid Koyeb worker or select another always-on host, then run exactly one indexer replica from block `55002177`. The current free web service sleeps and cannot provide continuous indexing.
2. Buy and sell a small amount of `LONGNICO` and confirm the explorer, API, and UI results. The creator dashboard already discovers the token directly on-chain.

## Working-tree safety

The branch inherited unrelated uncommitted UI, automatic WETH wrapping, USD valuation, and Stage0 research work. Do not revert it. `deployments.local-backup/` and `neon.ts` are also user-owned.
