# Leaderboard methodology changelog

Every methodology version bump gets an entry here. Snapshots are stored with their
`methodology_version` and are never rewritten; the API serves only the current version.

## curve-exit-realized-v3 (2026-11-26)

Spec: `docs/plans/2026-11-26-pulse-leaderboard-methodology.md` (section 12 owner decisions
override earlier sections). Plan: `docs/plans/2026-11-26-pulse-leaderboard-implementation-plan.md`.

### What changed from curve-known-basis-v2

- **Ranking:** sorted by absolute, sample-size-shrunk profit (`floor(P * n / (n + 8))` in wei),
  never by percent. Return in bps is display-only.
- **Open positions:** valued at the exact curve exit (`CurveMath.quoteSell` ported to BigInt),
  taking the lower of the current exit and the exit at a 6-hour TWAP curve state. Gross above
  real reserves is clamped to real reserves; unsellable dust is worth zero.
- **Open-position cap:** positive unrealized P&L counts toward the score only up to realized
  profit (at most 50% of scored P&L). A wallet without realized profit gets no paper upside.
- **Depth gate:** a position is marked only in markets with at least 0.5 WETH of real quote and
  5 other non-protocol traders; otherwise it is realized-only.
- **Stale or unpriceable markets** (no trade for 7 days, null/zero reserves, `ready` or
  `graduated` with no pool pricing yet) contribute 0 unrealized P&L; their cost stays in peak
  capital. They are never shown as -100%.
- **Transfers:** tokens leaving a wallet other than via a curve sell realize a loss at zero
  proceeds. Received tokens carry no basis and no value.
- **Creator-own token:** a creator's trades and transfers in their own token are excluded from
  P&L, counts and capital.
- **Removed cost on sells** rounds up (it previously floored).
- **Capital denominator:** peak net capital deployed across markets, so recycled capital is not
  double counted.
- **Qualifying trades:** only trades of at least 0.005 WETH and 1% of peak capital count toward
  trade, market and active-day thresholds.
- **Categories:** Track record (10 trades, 3 markets, 5 days, first trade 14+ days ago, active in
  30 days, 0.05 WETH peak capital, at most 60% of profit from one market, launch-window cap);
  Emerging (5 / 2 / 3, first trade under 14 days ago, 0.02 WETH); Trending (7-day window with
  positions re-based at their window-start exit value, 4 / 2 / 3, 0.02 WETH, no stale marks);
  Followers (social only, labelled "Most followed"). All P&L categories need positive scored
  profit. Track record and Emerging are disjoint.
- **Publishing:** recomputed from raw `trades` and `asset_transfers` at a block at least 20
  blocks behind head, after indexed activity (at most once per 60 s) and every 5 minutes. Snapshot
  rows record `as_of_block`, `as_of_time` and `status`; v3 snapshots older than 7 days are pruned
  except the latest per category.
- **Empty board:** no provisional ranking. The API returns `status: "no_qualifiers"` with the
  public requirements, anonymised progress counts and an unranked Watching list (`rank: null`,
  `provisional: true`, sorted by activity, no P&L or percentages). Before the first v3 publish
  the status is `pending`.
- **Freshness:** the API flags `stale` after 15 minutes and `paused` after 60.

### Owner decisions (spec section 12)

1. Capital floors stay at 0.02 WETH for P&L categories and 0.05 WETH for Track record.
2. The empty board shows the requirements checklist plus an unranked Watching list.
3. Linked-wallet clustering is deferred. Every evaluation carries an `entityId` (the wallet
   address today) and ranked categories keep one row per entity, so clustering can be added
   without reworking ranking.

### Not changed

- `curve_positions` and per-wallet `trader_performance_snapshots` keep their v2 behaviour and the
  `curve-known-basis-v2` label; the profile page still reads them.
- Older v1/v2 leaderboard snapshots are retained and never rewritten or served.
