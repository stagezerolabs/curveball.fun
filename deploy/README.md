# Curveball VPS deployment

This deployment runs the current recorded RISE testnet release behind the server's existing
`proxy` Docker network. Nginx Proxy Manager should route:

- `curveball.fun` to `curveball-testnet-web:8080`
- `social-api.curveball.fun` to `curveball-testnet-api:8787`

The social API proxy host must support WebSockets/streaming, disable response buffering for
`/v1/events`, and use a long read timeout. Apply a request body limit near 2.1 MB and a strict rate
limit to `/api/artwork` on the web host.

Required ignored files in this directory:

- `production.env`: Compose interpolation and public Vite build values.
- `social.env`: server-side social/indexer/worker settings.
- `keeper.env`: keeper wallet and runtime settings.
- `web.env`: server-only `PINATA_JWT`.

Generate them from the existing, matching testnet environments with:

```sh
bun deploy/prepare-production-env.mjs
```

Run all commands from the repository root:

```sh
docker compose --env-file deploy/production.env -f compose.production.yaml config
docker compose --env-file deploy/production.env -f compose.production.yaml build
docker compose --env-file deploy/production.env -f compose.production.yaml run --rm migrate
docker compose --env-file deploy/production.env -f compose.production.yaml up -d
```

Never use `docker compose down -v`; the `postgres_data` volume contains both rebuildable chain
projections and non-rebuildable social state. Back up and restore-test this database before treating
the deployment as durable.
