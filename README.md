# Curveball

Curveball is a React/Vite launchpad for RISE Mainnet. The app reads one configured `CurveLaunchpad`; deprecated deployments, fallbacks, and historical market discovery are not bundled.

## Production contracts

Four singletons run every market (see `docs/adr/0003-lean-singleton-launchpad.md` for the earlier architecture):

- `CurveLaunchpad` launches fixed 1,000,000,000-token supplies as clones, sells 800,000,000 of each on a virtual-reserve curve, and graduates a sold-out curve into a fresh volatile Icarus pool at the curve's closing price, burning the tokens it doesn't seed. A graduation stuck for 7 days aborts and curve trading resumes.
- `CurveFeeEscrow` splits curve and pool fees between the creator, the protocol treasury and the buyback treasury.
- `CurveBuybackTreasury` pools WETH buyback fees across markets, converts token-denominated LP fees to WETH, and buys and burns one permanently selected graduated CURVE token. Its owner selects that token after graduation.
- `CurveLpLocker` holds every pool's LP forever and forwards its fees to the escrow.

The new-release launch fee is fixed at 0.00045 WETH and goes straight to the immutable treasury. It is not yet pegged to $1: a USD fee requires a verified ETH/USD oracle on RISE and a defined stale-price policy. The recorded testnet deployment still uses the earlier 1,000,000-token supply and 0.001 WETH fee; these source changes take effect only on a new deployment. The production deployment record will live at `deployments/4153/curveball.json`. Until that record exists, `.env.production` intentionally has no launchpad address or deployment block and the production frontend must not be released.

### Testnet rehearsal

The testnet path deploys the current contracts against canonical RISE Testnet WETH and the live Icarus testnet factory. The `dot` Foundry keystore broadcasts the deployment and is the owner, guardian and treasury. Foundry prompts for the keystore password. It does not modify production configuration.

```bash
make deploy-testnet      # runs the contract suite, testnet forks, preflight, then broadcasts
make post-deploy-testnet # records, activates and recreates the stack, then launches and buys a smoke token
make set-testnet-graduation-target # owner update on the recorded live launchpad; prompts for dot password
make deploy-icarus-swap-testnet # deploy and verify the atomic adapter; prompts for dot password
make record-icarus-swap-testnet # verify its onchain wiring and save the runtime code hash
make activate-icarus-swap-testnet # configure the web app and rebuild Docker
```

The broadcast verifies all five contracts (the four singletons and the token implementation) on the RISE Testnet Blockscout. Recording validates every receipt, the singletons' wiring, policy values, bytecode hashes and verified sources before writing `deployments/11155931/curveball.json`. Activation updates the backend, keeper, and prepared VPS deployment env files, clears previous local chain projections and indexer cursors while keeping wallet profiles and follows, then rebuilds and recreates the complete local stack.

The recorded release uses Icarus's basic (V2) pool factory at `0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9`; [the Icarus testnet app](https://testnet.icarus.finance) can be used to inspect swaps and liquidity. Factory pause blocks basic-pool swaps only, so graduation and fee claims remain available. At the last documented testnet check, the volatile swap fee was 30 bps and 10% of that fee went to gauge rewards; both rates can change, including per pool. Curveball's locked LP collects its unstaked LP share. Buyback calls `sync()` before sampling two price intervals. Each observation requires more than 1,800 seconds since the previous one, so a quiet pool can have a longer lookback; schedule `sync()` about every 30 minutes only if a bounded lookback is needed.

Graduated markets use the same buy/sell panel to trade their canonical Icarus basic pool. The panel quotes the pool's fee-inclusive output, shows its current fee and pause state, and executes an atomic swap through `CurveIcarusSwapAdapter` with a minimum output based on the displayed quote. The adapter is permissionless and holds no user assets. Until its verified deployment record is activated, the panel shows that Icarus trading is unavailable and keeps wallet trading disabled. The pool explorer link remains available for inspection.

New deployments enforce a 4 WETH minimum graduation target, and the testnet deploy script uses 4 WETH. The recorded testnet launchpad currently reports a 4 WETH target, although its deployment record captures the original 0.01 WETH setting. The owner command changes the target for new markets; existing markets retain their launch-time curve parameters. The live contract's older bytecode still permits its owner to lower the target later; only the new release enforces the 4 WETH floor. The new release caps each wallet's net curve purchases at 40,000,000 tokens (5% of the 800,000,000-token curve allocation), so a complete sellout requires at least 20 buying addresses. `Smoke.s.sol` supports both launch ABIs and broadcasts only a launch with a 0.003 WETH first-buy budget; fund its broadcaster for that budget, the live launch fee, and gas. The testnet fork smoke suite uses dealt ETH to simulate sellout, graduation, a pool swap, and fee claims without spending live funds. Buys in the first five seconds after launch pay an additional treasury tax of 99%, 25%, 3%, 0.36%, or 0.04% at elapsed seconds 0–4, then zero.

### Mainnet deployment

Set `MAINNET_ACCOUNT=curveball` and a private `RISE_MAINNET_RPC_URL` in the ignored repository-level `.env`. The script permits only the `curveball` deployer (`0xeEb364Ba1a9A4B6a75C41A39c4B91144a4aF156A`). On mainnet it creates a self-administered two-day OpenZeppelin timelock as owner; `curveball` is its proposer and executor and the launchpad guardian. The protocol treasury is `0x7e6B1bEfC7dd622c20961140779eF61cd9C62Ce4`, and the initial graduation target is 4 WETH. The deploy transaction does not launch, buy, or graduate a market.

```bash
make production-preflight
CONFIRM_DEPLOY=DEPLOY_CURVEBALL_RISE_MAINNET_4153 make deploy-production
CONFIRM_RECORD_PRODUCTION=RECORD_CURVEBALL_RISE_MAINNET_4153 make record-production
make configure-production
CONFIRM_ICARUS_SWAP_DEPLOY=DEPLOY_ICARUS_SWAP_RISE_MAINNET_4153 make deploy-icarus-swap-mainnet # requires core record
make record-icarus-swap-mainnet # pins adapter wiring, bytecode and verified source
make activate-icarus-swap-mainnet # prepares mainnet env and builds isolated Compose images
```

The preflight runs the full Foundry suite, bytecode limits, the strict mainnet fork lifecycle against real Icarus, the Icarus bytecode check, and a dry-run of the deployment including the timelock and authority checks. The broadcast is restricted to chain `4153`, canonical RISE WETH, the reviewed Icarus factory and a 0.00045 WETH launch fee, and submits the timelock and five protocol contracts for Blockscout verification. Recording re-reads the wiring, timelock roles, and policy from the live chain and requires every source to be verified before writing the deployment record. Configuration then points `.env.production` at that launchpad.

After recording, set the same launchpad and deployment block in Vercel and the keeper. Do not copy deployment credentials, keystore passwords, or keeper keys into any `VITE_` variable.

## Keeper

The standalone worker in [`keeper/`](keeper/README.md) discovers launches and sends the permissionless market transactions: graduation, aborting a graduation stuck past its timeout, and guarded fee conversions and paced CURVE buybacks. Run one monitored instance with a dedicated, funded wallet. Its launchpad and deployment block must match the deployment record.

## Run with Docker

For the local stack, `compose.yaml` runs one backend container for the app, social API, indexer,
and metadata worker, plus the keeper and a local Postgres database. The app reads its launchpad
configuration from the root `.env` (written by `make configure-testnet`).

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
