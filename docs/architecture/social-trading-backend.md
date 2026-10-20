# Social trading backend

This document records the backend shape derived from the current Curveball UI, contracts, social fixtures, and production-readiness gaps. The UI is the product contract; onchain events are trading truth; PostgreSQL stores queryable projections and offchain social state.

## Module seams

- **Chain ingestion** verifies the configured chain, stores canonical block/log identity, indexes launch/trade/graduation events, and compensates for reorgs.
- **Accounting projector** turns canonical events into curve positions, market metrics, candles, and versioned performance snapshots. Its projections are rebuildable.
- **Market read model** owns discovery, search, market detail, trade history, candles, holder views, and protocol statistics.
- **Social graph** owns follows, blocks, notes, conviction reactions, and reports. Trader identity is the wallet plus its RNS name, with no editable fields and no visibility opt-out ([ADR 0004](../adr/0004-rns-only-trader-identity.md)).
- **Notification delivery** writes recipient records and a durable outbox; realtime delivery is downstream of the committed row.
- **Copy Assist** owns preferences, immutable intents/status events, and receipt-verified executions. Wallet signing and trade submission remain in the web app.

The HTTP interface is the external seam. Drizzle and raw query details remain inside the backend and `@curveball/db`.

## Authoritative data

| Concern | Authority | Stored projection |
|---|---|---|
| Launches, curve trades, graduation | Canonical contract events | Markets, trades, lifecycle state |
| Curve and graduated-pool price/volume | Canonical Curve `Trade` and verified Icarus `Swap` events | Market stats and interval candles |
| Exact token holdings | ERC-20 transfers, once indexed | Wallet holdings |
| Known-basis performance | Event-ordered Curve Trades | Curve positions and performance snapshots |
| Post-graduation market activity | Verified venue swaps and ERC-20 transfers | Venue executions, exact balances, and market candles |
| Profile and social graph | Authenticated wallet writes | Profiles, follows, blocks, notes, reactions |
| Copy outcome | Indexed follower transaction | Copy execution and status history |

“Curve position” and “known-basis PnL” remain explicit even with transfer and venue indexing. An Icarus `Swap` identifies the calling contract and output recipient, not necessarily the economic owner, so transfer-in, airdropped, and pool-acquired tokens do not receive invented wallet cost basis.

## Accounting invariants

- Every chain occurrence is identified by chain, block hash, transaction hash, and log index. Projectors are idempotent.
- A reorg marks the replaced occurrence noncanonical, retracts its chain-derived notifications, reverses verified copy outcomes, and rebuilds affected projections.
- Buy wallet cost equals `netTraderQuote` (gross curve quote plus fee and creator tax). Sell proceeds equal `netTraderQuote` (gross curve quote less fee and creator tax).
- Realized cost is removed in event order using the current weighted-average known basis. Later buys never rewrite the cost of an earlier sale.
- A sell exceeding known-basis quantity records the excess as unknown-basis; that portion contributes no fabricated realized PnL.
- Gross curve volume and wallet cash turnover are separate metrics. FDV and circulating market cap are separate metrics.
- System-account activity stays in the ledger and market totals but is excluded from human feeds, trader rankings, and social attribution.
- Only the indexer or receipt-verification worker can move a Copy Intent to `confirmed`.

## Current implementation status

Implemented:

- Shared Drizzle schema and ordered migrations in `packages/db`.
- Private `curveball` Postgres schema suitable for hosted Supabase.
- Pooled runtime versus direct migration connection support.
- Chain/RPC identity verification, raw log data, canonical block identity, and overlap rescans.
- Launch policy snapshots, market lifecycle fields, market stats, event-ordered curve positions, and system-account registry.
- Tuple-cursor feed pagination plus market discovery, detail, trade-history, candle, and protocol-stat reads.
- Interval candle projection and frontend market-list/chart/activity cutover to backend reads when the service is configured.
- Versioned known-basis performance snapshots and atomically published leaderboard snapshots.
- Pulse signal desk: 1h/24h grouped market moments, followed-trader moments, qualified trader snapshots, and an opt-in cursor-paginated raw trade record. Public moment summaries are cached for 30 seconds; the raw record no longer polls or subscribes on every page view.
- Pulse is fully service-backed: Now ranks net-buying markets, Following lists the markets the viewer's follows created, bought, or sold, and the leaderboard ranks traders. Market trade history and holder lists carry the viewer's follow flags, trade notes, and Conviction counts.
- Trader rankings use the `curve-known-basis-v2` method: minimum sample/spend requirements, current curve marks for open positions, stale-price and outbound-transfer guards, and visible snapshot methodology. Track record ranks estimated net known-basis PnL divided by cumulative curve buy spend; Emerging ranks estimated net known-basis PnL for newer qualified wallets. Neither proves a wallet represents an independent human or predicts future performance.
- Resumable Postgres-outbox SSE, cached RNS identity reads, and normalized token-metadata refresh.
- A shared API-process outbox poller serves SSE clients with bounded replay/backpressure instead of one database poll per connection. Authenticated social writes have a per-wallet process-local limit.
- Independently runnable API, advisory-locked indexer, and background worker processes.
- Privy access-token verification with linked active-wallet authorization.
- Profiles, follows, bidirectional block enforcement, reports, notes, conviction reactions, notifications, and preferences.
- Idempotent Copy Intents, append-only status events, submitted execution records, indexer confirmation, and reorg reversal.
- Copy preferences, reload-safe pending-intent recovery, execution history, and wallet-confirmed submission.
- ERC-20 holdings, protocol fee/buyback/reserve ledgers, holder snapshots, and protocol-stat reads.
- Verified Icarus pool swaps, reorg-aware venue execution history, and unified curve/pool market stats and candles.
- Onchain-factory-owner moderation queue operations in the existing admin surface.

Still required for the end state:

- Shared request/response validation.
- A standalone notification delivery publisher for channels beyond in-app resumable SSE.
- Structured telemetry, load testing at the target concurrency, and shared/edge rate limiting across API replicas. The current in-process wallet limit is not a distributed abuse control.

## Pulse capacity notes

`GET /v1/pulse` aggregates the full requested trade window into token/trader/time buckets before ranking moments; it does not infer completeness from an arbitrary 5,000-trade cap. The database selects the strongest window per market and returns at most 12 cards. The public result is cached for 30 seconds per API process. Viewers with blocks get a filtered, short-lived result; block graph reads are cached for up to 60 seconds across API replicas. Following is calculated for an authenticated viewer and cached briefly. At larger trade volumes, measure query time, cache hit rate, and database CPU before launch; a persisted rollup may be needed. The 3,000-active-user target has not been load-tested.

The published leaderboard is a read of a precomputed snapshot, not a request-time scan of all trades. Snapshot age, methodology version, sample requirements, and known-basis caveats are surfaced to readers. Existing v1 snapshots are deliberately withheld from the new Traders UI until a v2 publication succeeds.

## Cutover order

1. Apply Drizzle migrations to Supabase and backfill launches/trades.
2. Expose market reads and replace market-list/chart/activity full-history browser scans.
3. Publish exact curve-position and versioned performance reads; switch profiles and leaderboards to projections.
4. Move copy preferences and pending-intent recovery to the backend; add receipt reconciliation and history.
5. Publish the notification outbox and replace process-local realtime delivery.
6. Index transfers, protocol accounting, and verified venue swaps while preserving conservative known-basis attribution.
7. Remove direct-RPC compatibility reads after the hosted backend has completed its production backfill.
