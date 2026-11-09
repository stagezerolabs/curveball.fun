# Curveball backend

The Bun/Fastify backend serves the built app, artwork uploads, and social API on one listener. It also indexes factory launches, bonding-curve trades, ERC-20 transfers, protocol accounting, and verified Icarus pool swaps into Postgres. The authoritative Drizzle schema and generated migrations remain in `packages/db`; Postgres runs separately.

It never holds user wallet keys and never submits trades.

Pulse reads are served by `GET /v1/pulse?scope=now|following&period=1h|24h` and `GET /v1/following/activity`, which lists the markets the viewer's follows created, bought, or sold. The public Now result is cached for 30 seconds per API process; Following requires an authenticated wallet and honors the viewer's follow/block graph. `GET /v1/leaderboards/{consistent,new,trending,followers}` return published qualified snapshots with rank evidence. The raw `GET /v1/feed` remains available for the opt-in Live view with cursor pagination. Market reads `GET /v1/markets/:token/trades` and `/holders` carry the viewer's follow flags plus notes and Conviction counts when a wallet is signed in, and `GET /v1/notifications` serves every notification kind with an unread count. See [the architecture notes](../../docs/architecture/social-trading-backend.md) for capacity and methodology limits.

## API code layout

- `src/entrypoints/main.mjs` starts the combined backend, indexer, and metadata worker. `src/entrypoints/migrate.mjs` runs schema migrations before the backend starts.
- `src/web/routes.mjs` serves the built app and artwork upload through Fastify.
- `src/api/features/` groups routes and behavior for markets, social activity, Pulse, RNS, protocol stats, moderation, and notifications. Each feature keeps its controller next to its queries and rules.
- `src/api/auth/`, `src/api/transport/`, and `src/api/events/` hold shared authentication, HTTP, and event-stream code. `src/api/server.mjs` dispatches requests and handles errors.
- `src/analytics/`, `src/indexing/`, and `src/workers/` hold calculations, chain indexing, and metadata work. `src/platform/` holds configuration, database setup, TLS, and instrumentation.
- `tests/` mirrors these areas. Run all tests with `bun run test` from this directory.

## Run

Use Bun 1.4+ and Postgres. Run these commands from the repository root:

```bash
cp .env.example .env
bun install
bun run backend:migrate
bun run backend:start
```

The root package scripts load the root `.env` for local runs. On a VPS, provide the variables through systemd, Docker, or another process manager. Use Supabase's pooled connection for `SOCIAL_DATABASE_URL` and its direct/session connection for `SOCIAL_DIRECT_DATABASE_URL`; migrations must not run through transaction pooling. Supabase signs Postgres TLS with its own root CA, so `SOCIAL_DATABASE_SSL=true` also needs `SOCIAL_DATABASE_CA_FILE=certs/supabase-root-2021.crt` (bundled here, resolved relative to `services/backend`). The combined entrypoint runs HTTP, indexing, and metadata work in one process. The indexer holds a chain-scoped PostgreSQL advisory lock, so extra replicas remain standby rather than racing the canonical cursor.

For local Compose, set `SENTRY_BACKEND_DSN` in the root `.env`; Compose passes it as `SENTRY_DSN` to the backend. For standalone or VPS processes, set `SENTRY_DSN` to the **Curveball Backend** project DSN. The startup and Docker commands preload Sentry for Bun. Set `SENTRY_ENVIRONMENT=production` on the VPS and `SENTRY_RELEASE` to the deployed commit or version. Tracing samples 10% in production and 100% locally by default; `SENTRY_TRACES_SAMPLE_RATE` can override it. A missing DSN leaves Sentry disabled.

For the production Docker Compose stack, the one-shot `migrate` service applies ordered Drizzle migrations before the combined backend starts. Put a TLS reverse proxy in front of the backend. The backend receives the artwork upload credential as well as social configuration. The keeper and Postgres remain separate services.

Required variables are `SOCIAL_DATABASE_URL`, `SOCIAL_DIRECT_DATABASE_URL`, `SOCIAL_LAUNCHPAD_ADDRESS` and `SOCIAL_DEPLOYMENT_BLOCK` (the `launchpad` and `deploymentBlock` in `deployments/<chainId>/curveball.json`), `PRIVY_APP_ID`, and the server-only `PRIVY_APP_SECRET`. The indexer discovers the launchpad-wired quote token, treasury, fee escrow, and LP locker; `SOCIAL_PROTOCOL_ACCOUNTS` can add any deployment-specific system accounts that must stay out of human attribution.

When the indexer starts on a launchpad other than the one it last indexed, it retires the previous deployment: chain-derived rows (markets, trades, swaps, transfers, protocol flows) are marked orphaned as a reorg would, derived aggregates and cursors are cleared, and indexing restarts at `SOCIAL_DEPLOYMENT_BLOCK`. Profiles, follows, notes, reactions and copy intents are kept. Set `VITE_SOCIAL_API_URL` in the web app to this service's public origin.

## Safety boundary

- Wallet writes require a verified Privy access token and an active Ethereum address linked to that Privy user.
- Origins are allowlisted and state-changing requests require a matching Origin header.
- Raw log occurrences retain block hashes; the indexer rescans an overlap and marks replaced events orphaned.
- Icarus pool swaps retain both the contract caller and output recipient; neither is silently promoted to a human trader for PnL or leaderboards.
- Unauthored RNS name lookups that miss the cache are rate-limited per socket IP (120/minute) as a coarse ceiling; cached answers are free, and the indexer leader prunes expired `rns_cache` rows hourly.
- The live event stream caps concurrent clients at 500 total and 200 per socket IP; clients over the cap are told to retry in 60 seconds instead of reconnecting every few seconds.
- Application tables live in the private `curveball` schema rather than Supabase's API-exposed `public` schema.
- Put TLS and request-rate limiting in front of the service on the VPS.
