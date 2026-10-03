# Koyeb production runtime

The frontend remains a static Netlify build. Koyeb runs the API from the repository image and should run one always-on indexer from that same image. Both use the isolated RISE Testnet database; neither has a demo-data fallback. The hosted API and site still use V1. The V2 values below are for the pending Koyeb/Netlify cutover, not the current hosted configuration.

Production API: `https://curveball-kamicash-7a463851.koyeb.app`

## API service

- Build from the repository `Dockerfile`.
- Expose HTTP port `3001`.
- Keep the image default command: `bun run db:migrate && bun run start`.
- Health check: `GET /api/health`. It fails unless Postgres responds, the RPC reports chain `11155931`, and bytecode exists at `LAUNCHPAD_ADDRESS`.

Set these secrets/environment values on the API and indexer during the coordinated V2 cutover:

```dotenv
NODE_ENV=production
PORT=3001
DATABASE_URL={{ secret.curveball_testnet_database_url }}
DATABASE_SSL=true
RPC_URL={{ secret.curveball_testnet_rpc_url }}
EXPECTED_CHAIN_ID=11155931
CONTRACT_VERSION=v2
LAUNCHPAD_ADDRESS=0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf
INDEXER_START_BLOCK=55636468
# Optional but recommended: raises CoinGecko rate limits for the ETH/USD
# valuation source. Server-side only; never add a VITE_ key to the frontend.
COINGECKO_API_KEY={{ secret.coingecko_api_key }}
```

Without the key the ETH/USD provider still works through CoinGecko's public endpoint; under sustained rate limiting the API serves the last known rate with `usdStale: true` instead of failing `/api/tokens`.

## Indexer service

Use the same image and environment, override the command to:

```sh
bun run indexer
```

Run one indexer replica. It verifies the RPC chain and begins at `INDEXER_START_BLOCK`, avoiding a scan from genesis. Database writes are idempotent, but a single replica keeps RPC traffic and operational behavior predictable.

Koyeb Free Instances cannot run Worker Services and automatically scale web services to zero. The API currently uses the organization's single Free Instance. Reliable indexing therefore remains blocked until the operator authorizes an always-on paid worker or chooses another always-on host. Do not run multiple indexer replicas.

## Frontend build

Set these Netlify build variables and rebuild as part of the V2 cutover:

```dotenv
VITE_CHAIN_ID=11155931
VITE_RPC_URL=https://testnet.riselabs.xyz
VITE_CONTRACT_VERSION=v2
VITE_LAUNCHPAD_ADDRESS=0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf
VITE_DEPLOYMENT_BLOCK=55636468
```

The existing `/api/*` redirect points to the Koyeb API. Confirm the configured hostname is the service you deploy, then require `/api/health` to report chain `11155931` and smoke-test token creation, indexing, quotes, approvals, and a small buy/sell before announcing the deployment.

Do not provide Koyeb or Netlify with the `dot` keystore, password, private key, or treasury signing material. `.dockerignore` excludes local environment files and Foundry broadcast artifacts from the image build context.

## Cloudflare Worker boundary

The alternative Cloudflare deployment path (`src/worker.ts`, `wrangler.toml`) serves the V1 API and intentionally refuses any V2 configuration at startup. Pointing it at V2 requires its own API/indexer parity migration — V2 ABI reads, V2 event decoding, and the finalized-block indexer cursor — with tests mirroring `src/server.ts` and `src/indexer.ts`. Until that migration exists, hosted V2 traffic belongs to the Koyeb/Netlify stack above.
