# Curveball social service

This service indexes factory launches, bonding-curve trades, ERC-20 transfers, protocol accounting, and verified Icarus pool swaps into hosted Supabase Postgres. It serves market discovery/history/candles, exact holder snapshots, the social feed, public trader profiles, leaderboards, follows, notifications, and moderation. The authoritative Drizzle schema and generated migrations live in `packages/db`.

It never holds user wallet keys and never submits trades.

Pulse reads are served by `GET /v1/pulse?scope=now|following&period=1h|24h`. The public Now result is cached for 30 seconds per API process; Following requires an authenticated wallet and honors the viewer's follow/block graph. `GET /v1/leaderboards/consistent` and `/new` return published qualified snapshots with rank evidence. The raw `GET /v1/feed` remains available for the opt-in Live view with cursor pagination. See [the architecture notes](../../docs/architecture/social-trading-backend.md) for capacity and methodology limits.

## Run

Use Bun 1.4+ (or Node.js 20+ for the runtime) and a Supabase Postgres project.

```bash
cp services/social/.env.example services/social/.env
bun install
bun run social:migrate
bun run social:start
```

The process does not load `.env` automatically. Provide the variables through systemd, Docker, or another process manager. Use Supabase's pooled connection for `SOCIAL_DATABASE_URL` and its direct/session connection for `SOCIAL_DIRECT_DATABASE_URL`; migrations must not run through transaction pooling. Supabase signs Postgres TLS with its own root CA, so `SOCIAL_DATABASE_SSL=true` also needs `SOCIAL_DATABASE_CA_FILE=certs/supabase-root-2021.crt` (bundled here, resolved relative to `services/social`). Production should run the API, indexer, and worker entrypoints independently. The indexer holds a chain-scoped PostgreSQL advisory lock, so extra replicas remain standby rather than racing the canonical cursor.

```bash
bun run social:api
bun run social:indexer
bun run social:worker
```

For a long-running host with Docker Compose, copy `compose.example.yaml`, provide its required Supabase variables, and put a TLS reverse proxy in front of `127.0.0.1:8787`. The one-shot `migrate` service applies ordered Drizzle migrations before the API, indexer, and metadata worker start.

Required variables are `SOCIAL_DATABASE_URL`, `SOCIAL_DIRECT_DATABASE_URL`, `SOCIAL_LAUNCHPAD_ADDRESS` and `SOCIAL_DEPLOYMENT_BLOCK` (the `launchpad` and `deploymentBlock` in `deployments/<chainId>/curveball.json`), `PRIVY_APP_ID`, and the server-only `PRIVY_APP_SECRET`. `SOCIAL_FACTORY_ADDRESS` is still accepted as the old name. The indexer discovers the launchpad-wired quote token, treasury, fee escrow, LP locker and holder reserve; `SOCIAL_PROTOCOL_ACCOUNTS` can add any deployment-specific system accounts that must stay out of human attribution.

When the indexer starts on a launchpad other than the one it last indexed, it retires the previous deployment: chain-derived rows (markets, trades, swaps, transfers, protocol flows) are marked orphaned as a reorg would, derived aggregates and cursors are cleared, and indexing restarts at `SOCIAL_DEPLOYMENT_BLOCK`. Profiles, follows, notes, reactions and copy intents are kept. Set `VITE_SOCIAL_API_URL` in the web app to this service's public origin.

## Safety boundary

- Wallet writes require a verified Privy access token and an active Ethereum address linked to that Privy user.
- Origins are allowlisted and state-changing requests require a matching Origin header.
- Raw log occurrences retain block hashes; the indexer rescans an overlap and marks replaced events orphaned.
- Icarus pool swaps retain both the contract caller and output recipient; neither is silently promoted to a human trader for PnL or leaderboards.
- Application tables live in the private `curveball` schema rather than Supabase's API-exposed `public` schema.
- Put TLS and request-rate limiting in front of the service on the VPS.
