# curveball.fun

The replacement mainnet launch is being prepared locally. See [local-first mainnet preparation](docs/local-first-mainnet.md). The existing public app remains on RISE Testnet; the archived mainnet receipt is not the new deployment.

Curveball is a token-launch application for RISE. Anyone can create a fixed-supply ERC-20, trade it through a constant-product bonding curve, and graduate it into a volatile Icarus pool once the curve sells out. The accompanying web app lists markets, lets connected wallets create and trade tokens, and shows indexed trade history.

Curveball is deployed on RISE Testnet with a typed browser SDK and no production mock-data path. The dependency, fork, runtime, and build gates pass. It has not received an independent third-party audit.

- Network: RISE Testnet (`11155931`)
- Launchpad: [`0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E`](https://explorer.testnet.riselabs.xyz/address/0x1a34768eab2f6b925d25ca1d6dac03c1a25ad39e)
- LP locker: [`0xFC301f5349EB1ee9F12E8d6d446Ce5e526984782`](https://explorer.testnet.riselabs.xyz/address/0xfc301f5349eb1ee9f12e8d6d446ce5e526984782)
- Deployment block: `55002177`
- Testnet API: [`curveball-kamicash-7a463851.koyeb.app`](https://curveball-kamicash-7a463851.koyeb.app/api/health)
- Testnet UI: [`curveball-fun.netlify.app`](https://curveball-fun.netlify.app)
- Migration runbook: [`docs/rise-testnet.md`](docs/rise-testnet.md)

## What is here

| Area | Implementation |
| --- | --- |
| Smart contracts | Solidity 0.8.24 launchpad, locked token, LP locker, Icarus interfaces, local-only test doubles, Foundry/Echidna tests, and guarded production scripts |
| Web app | React 18, Vite, Wagmi, Viem, Zustand, and a small client-side router |
| SDK | Typed deployment checks, reads, quotes, exact approvals, trades, launches, claims, treasury handoff, receipt parsing, and normalized errors |
| API | Bun + Hono endpoints for health checks, token markets, and trade history |
| Data | Postgres with Drizzle migrations; an idempotent chain indexer persists `TokenCreated`, `Trade`, and `Graduated` events |
| Local stack | Docker Compose starts Postgres, the API/web server, and the indexer; `Makefile` wraps common commands |

## Product flow

1. A creator calls `createToken(name, symbol, uri)`. The launchpad deploys a deterministic `MemeToken` and holds its entire supply.
2. Buyers and sellers trade against the launchpad’s virtual constant-product curve using the configured quote token. Trades require `minOut` protection.
3. Before graduation, token transfers are limited to minting and transfers involving the launchpad. This keeps the initial market on the curve.
4. When `curveSupply` is sold, the launchpad creates or reuses an empty volatile Icarus pool, transfers the remaining token supply and collected quote liquidity, mints LP tokens to `LpLocker`, and unlocks the token.
5. `LpLocker` permanently holds the LP position. Anyone can claim a pool’s fees; it splits the received fee balance between the market creator and treasury using the configured basis-point share.
6. The indexer polls the launchpad in 1,000-block batches and records markets and trades. The API enriches active markets with on-chain price, market cap, and curve progress.

If graduation fails, the market is marked pending. Holders can still sell back to the curve; a sell below the cap reopens buying and a later full-curve buy retries graduation. This prevents an unavailable pool factory from trapping curve liquidity.

## Repository layout

```text
contracts/                 Solidity launchpad, locker, token, tests, and scripts
  contracts/               Production contracts, Icarus interfaces, and local mocks
  scripts/                 Local deployer, guarded devnet deployer, Icarus verifier
  test/                    Unit, regression, deployment, and optional fork tests
src/                       React client, Hono server, Drizzle schema, and indexer
  sdk/                     Sole browser-side contract integration layer
drizzle/                   Generated Postgres migrations
docs/                      Testnet runbook, historical mainnet spec, and security evidence
compose.yaml               App, indexer, and Postgres local stack
```

## Run locally

### Application

The app runs against the V2 RISE Testnet contracts from a local Postgres. Create the local V2 environment file and use the guarded Make targets (each one checks the chain, factory, and local database target before starting):

```sh
bun install
docker compose -f compose.yaml -f compose.dev.yaml up -d postgres
cp .env.example .env.v2.local
make migrate-v2-local
make dev-v2-api
make dev-v2-indexer
make dev-v2-web
```

See [`docs/runbooks/local-v2-testnet.md`](docs/runbooks/local-v2-testnet.md) for the full walk-through, including port conflicts and V2 indexer finality behavior. The root `.env` file is shared with the contract commands and holds verification and guarded deployment inputs.

For a containerized stack:

```sh
make up
make migrate
make seed
```

The app is served on `http://localhost:3001`. `make down` stops the stack. To run Postgres on the host for non-container development, use `docker compose -f compose.yaml -f compose.dev.yaml up -d postgres`; it listens on port `5433`.

### Local contracts

In one terminal, start a local JSON-RPC node:

```sh
cd contracts
pnpm install --frozen-lockfile
anvil
```

In another, compile, test, and deploy the mocked local stack:

```sh
cd contracts
pnpm compile
pnpm test
pnpm deploy:local
```

Read the deployed addresses from `broadcast/DeployLocal.s.sol/31337/run-latest.json`, then set them in the root `.env` and client build environment:

```dotenv
RPC_URL=http://127.0.0.1:8545
LAUNCHPAD_ADDRESS=0x...
VITE_CHAIN_ID=31337
VITE_LAUNCHPAD_ADDRESS=0x...
```

The browser wallet must also be connected to the local Anvil chain. The local deployment uses `MockWETH` as its quote token, so a wallet needs mock quote tokens and an allowance before buying.

## Commands

| Command | Purpose |
| --- | --- |
| `bun run dev` | Start the Bun API watcher and Vite client |
| `bun run build` | Build the web client |
| `bun run typecheck` | Type-check the application |
| `bun test` | Run Bun tests; database coverage runs when `TEST_DATABASE_URL` is set |
| `bun run indexer` | Run the event indexer when `LAUNCHPAD_ADDRESS` and `DATABASE_URL` are configured |
| `bun run db:generate` / `bun run db:migrate` | Generate or apply Drizzle migrations |
| `make test` | Run root type-checking and tests |
| `bun run --cwd=contracts test` | Run the Foundry contract suite |
| `make -C contracts test` | Run the full Foundry suite |

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Verifies Postgres, RISE chain ID, and launchpad bytecode |
| `GET /api/metadata/nominatebear` | Permanent metadata endpoint used by the first production token |
| `GET /api/tokens` | Returns indexed markets, enriched from the launchpad when configured |
| `GET /api/tokens/:address/transactions` | Returns indexed trades for a market |

The indexer owns all market data returned by the API. Creator-editable off-chain metadata is intentionally disabled until it has wallet-signature ownership verification.

Connected creators can open `/profile` from the wallet button to see every token they deployed. This dashboard reads launch events directly from RISE Testnet beginning at block `55002177`, so creator discovery does not depend on the hosted indexer being awake.

## RISE Testnet release gate

The testnet verification script pins the Icarus factory and implementation bytecode, checks the required ABI/state surface, validates RISE WETH, and runs the complete Curveball lifecycle on a fresh fork. The Icarus testnet contracts are not source-verified on Blockscout or Sourcify, so this is an explicitly accepted testnet risk. The gate only performs reads and writes evidence files; it never sends a transaction or stores the RPC URL.

```sh
RISE_TESTNET_RPC_URL=https://testnet.riselabs.xyz make -C contracts verify-icarus-testnet
```

Evidence is written to [`deployments/11155931/icarus-verification.json`](deployments/11155931/icarus-verification.json). The factory is `0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9`, its implementation is `0x74309f2134DA3E920094A5B0d5DF5d5Dcd1942b1`, and the only supported quote asset is RISE Testnet WETH `0x4200000000000000000000000000000000000006`.

```sh
cd contracts
forge test --match-path 'test/fork/*'
```

The canonical deployment is recorded in [`deployments/11155931/curveball.json`](deployments/11155931/curveball.json). Deployment remains interactive because Foundry must unlock the encrypted `dot` keystore locally. Follow [`docs/rise-testnet.md`](docs/rise-testnet.md); never place the keystore password on the command line.

The testnet launchpad and the archived mainnet launchpad share the same hexadecimal address because the same deployer nonce produced both. Always validate chain ID `11155931`; an address alone does not identify the deployment.

The release is not complete until the API health check reports testnet chain `11155931`, one always-on indexer is running from the deployment block, Netlify has the testnet launchpad address, and the documented `CBT` buy/sell smoke test succeeds.

## Security notes

- `LpLocker` validates that a pool was registered by the launchpad, derives payout tokens from that pool, and distributes only the balance delta received from `claimFees()`. Regression tests cover the historical cross-pool theft path. The current treasury can hand its role to a non-zero multisig without an upgrade or redeployment.
- The launchpad uses `SafeERC20`, `ReentrancyGuard`, checked packed-state casts, deterministic per-creator token salts, deadlines, and slippage limits. Its quote token must be verified RISE WETH; fee-on-transfer and rebasing assets are unsupported.
- The archived mainnet review, residual risks, static-analysis triage, and evidence map remain in [`docs/security/mainnet-security-review.md`](docs/security/mainnet-security-review.md); they do not constitute an independent audit of the new testnet deployment.

## Environment

[`.env.example`](.env.example) is the local V2 profile template; copy it to `.env.v2.local` for the Make targets above. The root `.env` (not committed) is shared with contract commands and holds verification and guarded deployment inputs; addresses used by the deployed V2 profile are recorded in [`deployments/11155931/curveball-v2.json`](deployments/11155931/curveball-v2.json).
