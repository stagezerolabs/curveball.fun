# Curveball VPS deployment

This stack runs one Bun/Fastify backend for the frontend, social API, indexer, metadata worker, and artwork uploads. The keeper and Postgres run separately behind the server's existing `proxy` Docker network. The `--network` argument to the env generator selects the recorded RISE deployment used by the frontend, backend, and keeper. The generator refuses mixed chain IDs, launchpads, or deployment blocks, and it never overwrites existing output files. The checked-in testnet record describes a legacy contract release; it is not a deployment record for the current four-singleton source.

## Prepare a RISE mainnet release

1. Set `MAINNET_ACCOUNT=curveball` and a private `RISE_MAINNET_RPC_URL` in the ignored root `.env`. The mainnet script pins the deployer, guardian, treasury, and 4 WETH target, and deploys a self-administered two-day timelock whose proposer and executor are `curveball`. Commit the `contracts/` tree, then run `make production-preflight`. It runs local and mainnet fork tests, the pinned Icarus/WETH code-hash gate, and a nonbroadcasting deployment simulation. Run `make deploy-production CONFIRM_DEPLOY=DEPLOY_CURVEBALL_RISE_MAINNET_4153` to repeat those gates and broadcast. After Blockscout verifies the sources, run `CONFIRM_RECORD_PRODUCTION=RECORD_CURVEBALL_RISE_MAINNET_4153 make record-production`. This checks the timelock, live four-singleton deployment, and compiled runtime before writing `deployments/4153/curveball.json`. Run `make configure-production` to copy the record's public values into `.env.production`.
2. Run `make deploy-icarus-swap-mainnet CONFIRM_ICARUS_SWAP_DEPLOY=DEPLOY_ICARUS_SWAP_RISE_MAINNET_4153` after the launchpad record exists. This target checks the adapter against a live Icarus pool and simulates deployment before broadcasting. Then run `make record-icarus-swap-mainnet`; it checks the deployment transaction, compiled creation code, wiring, receipt, and Blockscout source before writing `deployments/4153/icarus-swap-adapter.json`. Run `make configure-production` again to copy its address and code hash into `.env.production`. The env generator refuses mainnet without a matching adapter record.
3. Create ignored `.env.mainnet.local` with `VITE_ADMIN_ADDRESS`, `VITE_PRIVY_APP_ID`, optional `VITE_PRIVY_CLIENT_ID`, `PINATA_JWT`, and `CURVEBALL_TRUSTED_PROXY_CIDR`. Set the CIDR to the actual Docker `proxy` network subnet from `docker network inspect proxy`; only that network is trusted to supply client IP headers. `.env.production` supplies `VITE_CHAIN_ID`, `VITE_RPC_URL`, `VITE_LAUNCHPAD_ADDRESS`, `VITE_DEPLOYMENT_BLOCK`, and the Icarus adapter address and code hash. If the local file also defines any of those chain fields, their values must agree.
4. Create ignored `services/backend/.env.mainnet.local` and `keeper/.env.mainnet.local` from their respective `.env.example` files. Set chain `4153`, the exact recorded launchpad and deployment block, mainnet RPC URLs, `PRIVY_APP_ID` and the server-only `PRIVY_APP_SECRET`, the moderator address, and the dedicated funded keeper key. `SOCIAL_ADMIN_ADDRESS` must equal `VITE_ADMIN_ADDRESS`. Use a public browser-safe RPC in the Vite build and private provider endpoints for the backend and keeper.
5. Generate the four ignored Compose env files:

```sh
bun deploy/prepare-production-env.mjs --network mainnet
```

The generator writes `deploy/production.env`, `deploy/social.env`, `deploy/keeper.env`, and `deploy/web.env` with mode `0600`. Existing files are never overwritten. Use a separate checkout or Git worktree for concurrent testnet and mainnet releases because these generated env file paths are shared within a checkout. Each Makefile reads `.env` from its own checkout. The mainnet Compose overlay gives each release separate containers, networks, and Postgres volumes.

For a testnet release, the root `.env` contains the frontend, social, and keeper settings:

```sh
bun deploy/prepare-production-env.mjs --network testnet
```

The no-argument form continues to select testnet for existing callers.

After deploying a replacement testnet release, `make record-testnet` rechecks the live deployment and replaces the testnet record only if it matches current policy. `make configure-testnet` copies that record into `.env` and any already generated testnet env files. `make reset-testnet-projections` stops the app services, starts Postgres, and clears chain projections only when the local database contains a different testnet launchpad; it preserves wallet profiles, follows, and other user-owned social state. It restores previously running services unless `RESET_LEAVE_STOPPED=1`. `make activate-testnet` runs record, configure, conditional projection reset, and Docker rebuild in that order. These targets operate on the local testnet Compose project; they do not deploy contracts.

`make activate-icarus-swap-mainnet` refreshes `.env.production`, prepares the env files, validates Compose, and builds images. It does not restart the running stack. Because the env generator refuses to overwrite any existing output, use it in a checkout without previously generated `deploy/*.env` files.

## Start and verify the stack

The production Compose files use an external Docker network named `proxy`. On a new host,
create it once and attach the existing Nginx Proxy Manager container before starting the stack:

```sh
docker network inspect proxy >/dev/null 2>&1 || docker network create proxy
```

For mainnet, run from the mainnet checkout after reviewing the generated env files. Always supply both Compose files, in this order:

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml -f deploy/compose.mainnet.yaml config --quiet
docker compose --env-file deploy/production.env -f compose.production.yaml -f deploy/compose.mainnet.yaml build
docker compose --env-file deploy/production.env -f compose.production.yaml -f deploy/compose.mainnet.yaml run --rm migrate
docker compose --env-file deploy/production.env -f compose.production.yaml -f deploy/compose.mainnet.yaml up -d --remove-orphans
```

The overlay selects project `curveball-mainnet`, names its public containers `curveball-mainnet-web-edge` and `curveball-mainnet-api-edge`, routes both edges to one backend container on the private app network, and names its database volumes `curveball-mainnet-postgres-data` and `curveball-mainnet-postgres-backups`. It does not change the existing testnet stack. Route `curveball.fun` in Nginx Proxy Manager to `curveball-mainnet-web-edge:8081` and `social-api.curveball.fun` to `curveball-mainnet-api-edge:8788` only at cutover. The API edge disables buffering and uses a long read timeout for `/v1/events`, limits `/v1/rns/primary/` per client, and checks the upstream API for health; enable WebSocket support on the Proxy Manager host as well. The web edge applies a request body limit near 2.1 MB and a strict rate limit to `/api/artwork`; it rejects `/v1/` requests so API rate limits cannot be bypassed through the web domain. Before public cutover, test that Proxy Manager appends the real client IP to `X-Forwarded-For` and that forged client-supplied forwarding headers cannot evade the edge rate limits. The API edge overwrites `X-Curveball-Client-IP` for the private API; inspect RNS lookup limits from two distinct clients to confirm they are not grouped under one proxy address.

For the existing testnet release, continue using `compose.production.yaml` alone. Do not include the mainnet overlay in testnet commands.

After the replacement backend is healthy, run `make docker-clean-old-images`. It removes unused
images from the former `curveball-social`, `curveball-web`, and `curveball-frontend` image names;
it keeps any image still used by a container. Do not run broad Docker image or volume pruning
as part of this migration.

Verify `GET /health` reports chain `4153` and advancing cursors, then exercise a small mainnet launch, buy, sell, graduation, Icarus pool swap, fee claim, and keeper action with controlled wallets before opening public traffic. The health endpoint reports cursors but does not fail when they lag, so monitor cursor freshness and keeper logs separately.

Never use `docker compose down -v` on a live stack. The `postgres_data` volume contains both rebuildable chain projections and non-rebuildable social state. The included backup loop stores dumps on a local Docker volume for seven days; arrange an off-host encrypted backup and test a restore before treating the deployment as durable.
