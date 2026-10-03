# Local V2 app against RISE Testnet

The API, indexer, web app, and PostgreSQL run on localhost. Contract reads and wallet transactions use the [recorded V2 RISE Testnet deployment](../../deployments/11155931/curveball-v2.json). The hosted Koyeb and Netlify services stay on V1.

1. Start local PostgreSQL: `docker compose -f compose.yaml -f compose.dev.yaml up -d postgres`.
2. Copy `.env.example` to `.env.v2.local`. Set `DATABASE_URL` to the local Postgres database on port `5433`. This file is ignored by Git.
3. Apply the existing Drizzle migrations to this **local** database with `make migrate-v2-local`. Its guard checks the chain, factory, start block, and local Compose database target before invoking Drizzle. Database migrations still require the exact approval described in `AGENTS.md`.
4. In separate terminals, run `make dev-v2-api`, `make dev-v2-indexer`, and `make dev-v2-web`. The API normally uses port `3001`; Vite prints its local web URL and proxies `/api` to the local API. If port `3001` already hosts V1, run `PORT=3002 make dev-v2-api` and `API_URL=http://127.0.0.1:3002 make dev-v2-web` instead.
5. Confirm `/api/health` reports chain `11155931`, version `v2`, and factory `0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf`. Confirm `/api/config` lists the V2 services, then exercise launch, buy, sell, graduation, pool fee claim, and buyback indexing with a testnet wallet.

The browser wallet must be on RISE Testnet with test ETH. The local indexer starts at deployment block `55636468`; its separate V2 cursor leaves any V1 rows in the local database untouched. Keep the API and indexer running while testing so new markets appear in the local app.

The V2 indexer persists only blocks reported as `finalized` by the RISE RPC, so a new launch may take time to appear in the API even after its wallet receipt confirms. Wallet holdings and holder counts are unavailable until ERC-20 transfers and post-graduation trades are indexed; the API returns `501` for those endpoints rather than presenting curve trade totals as balances.
