# Curveball VPS deployment

The mainnet stack runs one Bun/Fastify container for the app, API, and indexer, plus a keeper, Postgres, a local backup job, and two Nginx edges on the existing `proxy` Docker network. The oracle v3 deployment and full database reset are described in [the release runbook](../docs/operations/oracle-launch-fee-release.md).

## Prepare the oracle release

After `make deploy-mainnet-dot`, `make record-mainnet-dot`, `make deploy-swap-mainnet-dot`, and `make record-swap-mainnet-dot` have completed in the operator's local shell, run `make configure-mainnet-dot`. It writes the new address and deployment block to `.env.production`, and updates existing ignored service and Compose env files. Transfer the new source and both `deployments/4153/*-oracle-v3.json` records to `/opt/curveball-mainnet`, following [the production file transfer procedure](../.codex/DEPLOYMENT.md). Run `make configure-mainnet-host` on the VPS; its Python script updates existing secret-bearing env files while preserving their other values and file ownership. The VPS does not need Bun or jq installed on the host.

For a first deployment with no generated env files, create `.env.mainnet.local`, `services/backend/.env.mainnet.local`, and `keeper/.env.mainnet.local` from their examples. Set chain 4153, the recorded launchpad and deployment block, RPC URLs, Privy values, and the moderator address. `SOCIAL_ADMIN_ADDRESS` must equal `VITE_ADMIN_ADDRESS`. Use a browser-safe public RPC in Vite and private endpoints for the backend and keeper. Then run `bun deploy/prepare-production-env.mjs --network mainnet` to generate `deploy/production.env`, `deploy/social.env`, `deploy/keeper.env`, and `deploy/web.env` with mode 0600. The generator refuses mismatched records and existing outputs.

Provision the keeper key outside the checkout. The Compose overlay mounts it for UID/GID `2001` at `/run/secrets/keeper_private_key`:

```sh
sudo install -d -o root -g root -m 0711 /opt/curveball-mainnet-secrets
sudo install -o 2001 -g 2001 -m 0400 /secure/source/keeper.key /opt/curveball-mainnet-secrets/keeper.key
```

The key file contains only a `0x`-prefixed private key and optional trailing newline. Never place it in a `VITE_` variable or a command argument.

Check the rendered production stack before reset:

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml -f deploy/compose.mainnet.yaml config --quiet
```

## Full reset and activation

From `/opt/curveball-mainnet` on the VPS, run:

```sh
make reset-mainnet-database CONFIRM_RESET=DELETE_ALL_CURVEBALL_MAINNET_DATA
```

The target checks the v3 records and environment parity, builds replacement images, stops the mainnet Compose project, deletes **both** `curveball-mainnet-postgres-data` and `curveball-mainnet-postgres-backups`, and starts the new stack. It clears profiles and follows along with every market, trade, chart, note, notification, and cursor. Existing onchain markets remain on the old contract but are absent from the new app. Any off-host database copy is outside this command's reach.

The overlay names its public containers `curveball-mainnet-web-edge` and `curveball-mainnet-api-edge`. Route `curveball.fun` to `curveball-mainnet-web-edge:8081` and `social-api.curveball.fun` to `curveball-mainnet-api-edge:8788`. The API edge forwards `/v1/events` without buffering; the web edge limits artwork uploads and rejects `/v1/` requests.

Confirm the API and both edges report healthy, then check the empty market list and `make oracle-status-mainnet`. Do not send a live token launch or buy as a verification step. The local backup job will begin new backups of the fresh database after restart. If an off-host archive of the old database exists and the full reset policy covers it, remove it through its own storage procedure.
