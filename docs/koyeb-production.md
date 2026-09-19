# Koyeb production runtime

The frontend remains a static Netlify build. Koyeb runs two services from the same repository image: the API and the indexer. Both use production Postgres and the verified RISE mainnet deployment; neither has a demo-data fallback.

Production API: `https://curveball-kamicash-7a463851.koyeb.app`

## API service

- Build from the repository `Dockerfile`.
- Expose HTTP port `3001`.
- Keep the image default command: `bun run db:migrate && bun run start`.
- Health check: `GET /api/health`. It fails unless Postgres responds, the RPC reports chain `4153`, and bytecode exists at `LAUNCHPAD_ADDRESS`.

Set these secrets/environment values after deployment:

```dotenv
NODE_ENV=production
PORT=3001
DATABASE_URL=postgresql://...
DATABASE_SSL=true
RPC_URL=https://...
EXPECTED_CHAIN_ID=4153
LAUNCHPAD_ADDRESS=0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E
INDEXER_START_BLOCK=22216399
```

## Indexer service

Use the same image and environment, override the command to:

```sh
bun run indexer
```

Run one indexer replica. It verifies the RPC chain and begins at `INDEXER_START_BLOCK`, avoiding a scan from genesis. Database writes are idempotent, but a single replica keeps RPC traffic and operational behavior predictable.

Koyeb Free Instances cannot run Worker Services and automatically scale web services to zero. The API is currently deployed on the organization's single Free Instance for UI testing. Before the production token launch, move the organization to Starter or higher and deploy the indexer as an always-on `eco-nano` worker (currently listed by Koyeb at approximately $1.61/month), or choose an equivalent always-on instance.

## Frontend build

Set these Netlify build variables and rebuild after the launchpad is verified:

```dotenv
VITE_CHAIN_ID=4153
VITE_RPC_URL=https://...
VITE_LAUNCHPAD_ADDRESS=0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E
```

The existing `/api/*` redirect points to the Koyeb API. Confirm the configured hostname is the service you deploy, then smoke-test `/api/health`, `/api/metadata/nominatebear`, token creation, indexing, quotes, approvals, and a small buy/sell before announcing the deployment.

Do not provide Koyeb or Netlify with the `dot` keystore, password, private key, or treasury signing material.
