# Curveball

Curveball is a React/Vite launchpad for RISE Mainnet. The app reads one configured `CurveLaunchpad`; deprecated deployments, fallbacks, and historical market discovery are not bundled.

## Production contracts

Four singletons run every market (see `docs/adr/0003-lean-singleton-launchpad.md` for the earlier architecture):

- `CurveLaunchpad` launches fixed 1,000,000,000-token supplies as clones, sells 800,000,000 of each on a virtual-reserve curve, and graduates a sold-out curve into a fresh volatile Icarus pool at the curve's closing price, burning the tokens it doesn't seed. A graduation stuck for 7 days aborts and curve trading resumes.
- `CurveFeeEscrow` splits curve and pool fees between the creator, the protocol treasury and the buyback treasury.
- `CurveBuybackTreasury` pools WETH buyback fees across markets, converts token-denominated LP fees to WETH, and buys and burns one permanently selected graduated CURVE token. Its owner selects that token after graduation.
- `CurveLpLocker` holds every pool's LP forever and forwards its fees to the escrow.

The oracle v3 source charges WETH worth at least $1 from Stork's RISE mainnet ETH/USDC feed. The launchpad reads the Stork proxy at `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` and rejects prices older than 30 minutes, future prices, and values outside $100–$100,000 per ETH. The creator reviews a WETH cap before launch. There is no fixed-fee branch in the new app and no old market discovery. The existing onchain launchpad and its markets cannot be erased; the full reset clears the app database, including profiles, follows, trades, charts, and its on-host backup volume. The production app remains on the prior release until the operator deploys and activates v3.

### RISE mainnet release from `dot`

Use the `dot` Foundry keystore (`0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3`) in your own shell. Set `RISE_MAINNET_RPC_URL` in ignored `.env` if you prefer a private endpoint; the targets otherwise use `https://rpc.risechain.com`. The new mainnet timelock gives `dot` proposer, executor, and canceller roles. The protocol treasury remains `0x7e6B1bEfC7dd622c20961140779eF61cd9C62Ce4`.

```bash
make oracle-status-mainnet       # read-only Stork freshness and fee check
make preflight-mainnet-dot        # tests, fork tests, dependency checks, dry run
make deploy-mainnet-dot           # deploy oracle launchpad and singletons from dot
make record-mainnet-dot           # verify receipts, wiring, bytecode, source, oracle policy
make deploy-swap-mainnet-dot      # deploy the new swap adapter from dot
make record-swap-mainnet-dot      # verify and record its wiring and bytecode
make configure-mainnet-dot        # update frontend, backend, keeper, and release envs
make oracle-status-mainnet       # read-only check of the deployed launchpad quote
```

The mainnet commands do not launch a token, buy, or run a smoke transaction. Record and publish the new deployment files and updated source before activating the VPS. On the VPS, stage the files and existing secrets as described in [the release runbook](docs/operations/oracle-launch-fee-release.md), run `make configure-mainnet-dot`, then run the explicitly destructive full reset:

```bash
cd /opt/curveball-mainnet
make reset-mainnet-database CONFIRM_RESET=DELETE_ALL_CURVEBALL_MAINNET_DATA
```

The reset builds the new API and keeper images, removes both `curveball-mainnet-postgres-data` and `curveball-mainnet-postgres-backups`, and recreates the stack and schema. It refuses mismatched chain, record, and environment addresses. Nothing is reset by the deploy command. See [the release runbook](docs/operations/oracle-launch-fee-release.md) for the complete sequence, scope, and checks.

### Testnet rehearsal

The oracle testnet targets are `make testnet-preflight`, `make deploy-testnet-oracle`, `make record-testnet-oracle`, `make deploy-swap-testnet-oracle`, `make record-swap-testnet-oracle`, and `make configure-testnet-oracle`. They use the same oracle-only contract and `dot` signer. Mainnet release does not require a live testnet smoke launch; Foundry fork tests simulate launches and graduation without onchain transactions.

## Keeper

The standalone worker in [`keeper/`](keeper/README.md) discovers launches and sends the permissionless market transactions: graduation, aborting a graduation stuck past its timeout, and guarded fee conversions and paced CURVE buybacks. Run one monitored instance with a dedicated, funded wallet. Its launchpad and deployment block must match the deployment record.

## Run with Docker

For the local stack, `compose.yaml` runs one backend container for the app, social API, indexer,
and metadata worker, plus the keeper and a local Postgres database. The app reads its launchpad
configuration from the root `.env` (written by `make configure-testnet-oracle` after testnet deployment).

```bash
# Copy .env.example to .env and fill in app, backend, keeper, and secret values.
# Compose supplies the local Postgres URLs.
make docker-setup
```

Open `http://127.0.0.1:5173` for the app and `http://127.0.0.1:8787/health` for the API. Both
ports reach the same backend container. Set `FRONTEND_PORT`, `SOCIAL_API_PORT`, or `POSTGRES_PORT`
to move a host port. The database persists in the `preview_postgres` Docker volume. Secrets are
injected from the ignored root `.env` at runtime and never baked into the image. Rebuild the
backend after source changes with `docker compose up -d --build api`.
After the unified stack is healthy, run `make docker-clean-old-images` to remove unused
`curveball-social`, `curveball-web`, and `curveball-frontend` images. Images still used by
containers are kept.

For a completely fresh local testnet state, run `make docker-fresh-testnet`. It removes the local
Postgres volume, including profiles, follows, and notifications, then rebuilds the stack.

## Run locally

```bash
cp .env.example .env
bun install
bun run dev
```

Set `VITE_LAUNCHPAD_ADDRESS` and `VITE_DEPLOYMENT_BLOCK` to the deployment you want to inspect. Set `VITE_PRIVY_APP_ID` to the public app ID from the Privy dashboard; `VITE_PRIVY_CLIENT_ID` is optional when using a configured app client. Privy handles account registration, embedded wallet creation, and external wallet connections. Keep `PRIVY_APP_SECRET` server-only in the ignored root `.env`.

Artwork uploads require a server-only `PINATA_JWT` with Pinata Files write permission. Never prefix it with `VITE_`. Apply an edge rate limit to `/api/artwork` before opening public uploads.

## Unified backend

The Bun/Fastify backend in [`services/backend/`](services/backend/README.md) serves the built app, artwork uploads, and social API on one listener. It uses the shared Drizzle data module in [`packages/db/`](packages/db/) and connects to a separate Postgres service. It indexes confirmed launches, curve trades, token transfers, protocol flows, and graduated Icarus-pool swaps; serves market data, public profiles, leaderboards, holder snapshots, and moderation; and stores follows, notifications, reports, and Copy Assist audit records. The backend never holds user trading keys or submits trades.

The web app uses only indexed and stored backend data for social surfaces. Point `VITE_SOCIAL_API_URL` at the service; when it is absent, the UI shows an explicit disconnected state rather than fabricated activity. Authenticated requests carry the current Privy access token and active linked wallet address; the backend verifies both before authorizing a write.

Set `VITE_SOCIAL_API_URL` to the public TLS origin of the backend. Run its schema migration once, then keep the combined backend and separate keeper supervised on the VPS:

```bash
bun run backend:migrate
bun run backend:start
```

## Checks

```bash
bun run typecheck
bun test
bun run build
make -C contracts test
```

Never commit private keys, seed phrases, keystore passwords, or credential-bearing RPC URLs.

Sells reopen a wallet's curve capacity; pool trading after graduation is unrestricted.
