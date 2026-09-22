# Koyeb production runtime

The frontend remains a static Netlify build. Koyeb runs the API from the repository image and should run one always-on indexer from that same image. Both use the isolated RISE Testnet database and deployment; neither has a demo-data fallback.

Production API: `https://curveball-kamicash-7a463851.koyeb.app`

## API service

- Build from the repository `Dockerfile`.
- Expose HTTP port `3001`.
- Keep the image default command: `bun run db:migrate && bun run start`.
- Health check: `GET /api/health`. It fails unless Postgres responds, the RPC reports chain `11155931`, and bytecode exists at `LAUNCHPAD_ADDRESS`.

Set these secrets/environment values after deployment:

```dotenv
NODE_ENV=production
PORT=3001
DATABASE_URL={{ secret.curveball_testnet_database_url }}
DATABASE_SSL=true
RPC_URL={{ secret.curveball_testnet_rpc_url }}
EXPECTED_CHAIN_ID=11155931
LAUNCHPAD_ADDRESS=0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E
INDEXER_START_BLOCK=55002177
```

## Indexer service

Use the same image and environment, override the command to:

```sh
bun run indexer
```

Run one indexer replica. It verifies the RPC chain and begins at `INDEXER_START_BLOCK`, avoiding a scan from genesis. Database writes are idempotent, but a single replica keeps RPC traffic and operational behavior predictable.

Koyeb Free Instances cannot run Worker Services and automatically scale web services to zero. The API currently uses the organization's single Free Instance. Reliable indexing therefore remains blocked until the operator authorizes an always-on paid worker or chooses another always-on host. Do not run multiple indexer replicas.

## Frontend build

Set these Netlify build variables and rebuild after the launchpad is verified:

```dotenv
VITE_CHAIN_ID=11155931
VITE_RPC_URL=https://testnet.riselabs.xyz
VITE_LAUNCHPAD_ADDRESS=0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E
```

The existing `/api/*` redirect points to the Koyeb API. Confirm the configured hostname is the service you deploy, then require `/api/health` to report chain `11155931` and smoke-test token creation, indexing, quotes, approvals, and a small buy/sell before announcing the deployment.

Do not provide Koyeb or Netlify with the `dot` keystore, password, private key, or treasury signing material. `.dockerignore` excludes local environment files and Foundry broadcast artifacts from the image build context.
