# Curveball

Curveball is a React/Vite launchpad for RISE Mainnet. The app reads one configured `CurveLaunchpad`; deprecated deployments, fallbacks, and historical market discovery are not bundled.

## Production contracts

Four singletons run every market (see `docs/adr/0003-lean-singleton-launchpad.md`):

- `CurveLaunchpad` launches fixed 1,000,000-token supplies as clones, sells 800,000 of each on a virtual-reserve curve, and graduates a sold-out curve into a fresh volatile Icarus pool at the curve's closing price, burning the tokens it doesn't seed. A graduation stuck for 7 days aborts and curve trading resumes.
- `CurveFeeEscrow` splits curve and pool fees between the creator, the treasury and a per-market buyback that buys the token from its pool and burns it.
- `CurveLpLocker` holds every pool's LP forever and forwards its fees to the escrow.
- `CurveHolderReserve` holds each launch's optional 0–4% reserve, which curve buyers claim pro rata after graduation.

The 0.001 WETH launch fee goes straight to the immutable treasury. The production deployment record will live at `deployments/4153/curveball.json`. Until that record exists, `.env.production` intentionally has no launchpad address or deployment block and the production frontend must not be released.

### Testnet rehearsal

The testnet path deploys the same contracts against canonical RISE Testnet WETH and the live Icarus testnet factory, with the `dot` operator as owner, guardian and treasury. It broadcasts from the dedicated `curveball-testnet-deployer` Foundry keystore (password file beside it in `~/.foundry`), never from `dot`. It does not read or modify production configuration.

```bash
make deploy-testnet      # runs the offline suite, the testnet forks and the preflight first
make record-testnet
make configure-testnet
make -C contracts smoke-testnet   # optional: one market from launch to graduation (~0.021 ETH)
```

The broadcast verifies all five contracts (the four singletons and the token implementation) on the RISE Testnet Blockscout. Recording validates every receipt, the singletons' wiring, policy values, bytecode hashes and verified sources before writing `deployments/11155931/curveball.json`. Configuration then writes this checkout's `.env.local` and `.env.testnet.local` only, never the main checkout's shared `.env`.

### Mainnet deployment

Copy `.env.example` to the repository-level `.env` and set the `CURVE_*` values. Use a private RISE Mainnet RPC endpoint. The owner must be a `TimelockController` with a delay whose proposer is a multisig, and the guardian and treasury must be contracts; the preflight refuses anything else.

```bash
make production-preflight
CONFIRM_DEPLOY=DEPLOY_CURVEBALL_RISE_MAINNET_4153 make deploy-production
CONFIRM_RECORD_PRODUCTION=RECORD_CURVEBALL_RISE_MAINNET_4153 make record-production
make configure-production
```

The preflight runs the full Foundry suite, bytecode limits, the strict mainnet fork lifecycle against real Icarus, the Icarus bytecode check, and a dry-run of the deployment including the authority checks. The broadcast is restricted to chain `4153`, canonical RISE WETH, the reviewed Icarus factory and a 0.001 WETH launch fee, and submits all five contracts for Blockscout verification. Recording re-reads the wiring and policy from the live chain and requires every source to be verified before writing the deployment record. Configuration then points `.env.production` at that launchpad.

After recording, set the same launchpad and deployment block in Vercel and the keeper. Do not copy deployment credentials, keystore passwords, or keeper keys into any `VITE_` variable.

## Keeper

The standalone worker in [`keeper/`](keeper/README.md) discovers launches and sends the permissionless market transactions: graduation, aborting a graduation stuck past its timeout, and paced buybacks. Run one monitored instance with a dedicated, funded wallet. Its launchpad and deployment block must match the deployment record.

## Run with Docker

For the local stack, `compose.yaml` runs the frontend, social API, indexer, worker, keeper, and a
local Postgres database in one stack — no external database. The frontend reads its launchpad
configuration from `.env.local` (written by `make configure-testnet`).

```bash
# .env: shared values such as PINATA_JWT and VITE_WALLETCONNECT_PROJECT_ID
# services/social/.env: chain, Privy, and Sentry settings (database URLs default to the local stack)
# keeper/.env: keeper and Sentry settings
docker compose up -d --build
```

Open `http://127.0.0.1:5173` for the frontend and `http://127.0.0.1:8787/health` for the API. Set
`FRONTEND_PORT`, `SOCIAL_API_PORT`, or `POSTGRES_PORT` to move any host port. The database persists in
the `preview_postgres` Docker volume. Secrets are injected from the ignored env files at runtime and
never baked into the images. Rebuild the frontend after source changes with
`docker compose up -d --build frontend`.

## Run locally

```bash
cp .env.example .env.local
bun install
bun run dev
```

Set `VITE_LAUNCHPAD_ADDRESS` and `VITE_DEPLOYMENT_BLOCK` to the deployment you want to inspect. Set `VITE_PRIVY_APP_ID` to the public app ID from the Privy dashboard; `VITE_PRIVY_CLIENT_ID` is optional when using a configured app client. Privy handles account registration, embedded wallet creation, and external wallet connections. Keep `PRIVY_APP_SECRET` server-only in `services/social/.env`.

Artwork uploads require a server-only `PINATA_JWT` with Pinata Files write permission. Never prefix it with `VITE_`. Apply an edge rate limit to `/api/artwork` before opening public uploads.

## Social service

The social trading backend uses the service in [`services/social/`](services/social/README.md) and the shared Drizzle data module in [`packages/db/`](packages/db/). It indexes confirmed launches, curve trades, token transfers, protocol flows, and graduated Icarus-pool swaps into hosted Supabase Postgres; serves market data, public profiles, leaderboards, holder snapshots, and moderation; and stores follows, notifications, reports, and Copy Assist audit records. The service never holds user trading keys or submits trades.

The web app uses only indexed and stored backend data for social surfaces. Point `VITE_SOCIAL_API_URL` at the service; when it is absent, the UI shows an explicit disconnected state rather than fabricated activity. Authenticated requests carry the current Privy access token and active linked wallet address; the backend verifies both before authorizing a write.

Set `VITE_SOCIAL_API_URL` to the public TLS origin of that service. Run its schema migration once, then keep one indexer process supervised on the VPS:

```bash
bun run social:migrate
bun run social:api
bun run social:indexer
bun run social:worker
```

## Checks

```bash
bun run typecheck
bun test
bun run build
make -C contracts test
```

Never commit private keys, seed phrases, keystore passwords, or credential-bearing RPC URLs.
