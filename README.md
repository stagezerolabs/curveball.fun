# curveball.fun

Curveball is a token-launch application for RISE. Anyone can create a fixed-supply ERC-20, trade it through a constant-product bonding curve, and graduate it into a volatile Icarus pool once the curve sells out. The accompanying web app lists markets, lets connected wallets create and trade tokens, and shows indexed trade history.

Curveball is deployed on RISE mainnet with a typed browser SDK and no production mock-data path. Its automated contract, fork, property, SDK, runtime, and build gates pass. It has not received an independent third-party audit; read [`docs/security/mainnet-security-review.md`](docs/security/mainnet-security-review.md) before handling real value.

- Launchpad: [`0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E`](https://explorer.risechain.com/address/0x1a34768eab2f6b925d25ca1d6dac03c1a25ad39e)
- LP locker: [`0xFC301f5349EB1ee9F12E8d6d446Ce5e526984782`](https://explorer.risechain.com/address/0xfc301f5349eb1ee9f12e8d6d446ce5e526984782)
- Deployment block: `22216399`

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
docs/                      Mainnet spec, Koyeb runbook, and security evidence
compose.yaml               App, indexer, and Postgres local stack
```

## Run locally

### Application

Install Bun dependencies, create a local environment file, and start the API and Vite client in separate processes:

```sh
bun install
cp .env.example .env
# Set DATABASE_URL. Local development may omit LAUNCHPAD_ADDRESS; production fails closed.
bun run dev:api
bun run dev:web
```

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

## RISE mainnet release gate

The verification script reads the official Icarus factory and implementation, fetches their Blockscout-verified sources, checks the required ABI surface, validates RISE WETH, runs the fork lifecycle, and produces a source diff against Aerodrome reference contracts. It only performs reads and writes evidence files; it never sends a transaction or stores the RPC URL.

```sh
# Set an HTTPS RISE_RPC_URL in .env, review the archived diff, then acknowledge it.
HUMAN_REVIEW_ACK=ICARUS_DIFF_REVIEWED_2026_09_19 make -C contracts verify-icarus
```

Evidence is written to `deployments/4153/icarus-verification.json` with verified sources and `icarus-vs-aerodrome.diff` beside it. The factory is `0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615`, its verified implementation is `0xA24Bdf8ee26658c822796a30770F23c2425de966`, and the only supported quote asset is verified RISE WETH `0x4200000000000000000000000000000000000006`.

```sh
cd contracts
forge test --match-path 'test/fork/*'
```

The canonical deployment is recorded in [`deployments/4153/curveball.json`](deployments/4153/curveball.json). First-token creation remains interactive because Foundry must unlock the encrypted `dot` keystore locally:

```sh
CONFIRM_TOKEN=CREATE_NOMINATEBEAR_NBR LAUNCHPAD_ADDRESS=0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E make -C contracts create-nominatebear
```

Never place the keystore password on the command line. Follow [`docs/koyeb-production.md`](docs/koyeb-production.md), verify the metadata endpoint is live, and only then create NominateBear.

## Security notes

- `LpLocker` validates that a pool was registered by the launchpad, derives payout tokens from that pool, and distributes only the balance delta received from `claimFees()`. Regression tests cover the historical cross-pool theft path. The current treasury can hand its role to a non-zero multisig without an upgrade or redeployment.
- The launchpad uses `SafeERC20`, `ReentrancyGuard`, checked packed-state casts, deterministic per-creator token salts, deadlines, and slippage limits. Its quote token must be verified RISE WETH; fee-on-transfer and rebasing assets are unsupported.
- The current review, residual risks, static-analysis triage, and evidence map are in [`docs/security/mainnet-security-review.md`](docs/security/mainnet-security-review.md).

## Environment

Root [`.env.example`](.env.example) defines application, database, frontend, verification, and guarded deployment inputs. Copy it once to `.env`; contract commands load that shared file. Addresses are deliberately absent from the template.
