# Pulse Trader Leaderboard Methodology (v3 proposal)

Status: scoping spec, no code changed. Target methodology id: `curve-exit-realized-v3`.
Supersedes `curve-known-basis-v2` (`services/backend/src/analytics/performance.mjs`).

## 1. Principles

1. Rank on value a wallet could actually bank: realized P&L plus a conservative **exit-value** mark, never spot.
2. Rank on **absolute risk-adjusted profit with shrinkage**, not raw percent. Display percent, never sort by it.
3. Exclude what we cannot attribute (unknown basis, creator-own-token, linked wallets) instead of guessing.
4. If nobody qualifies, say so. Never show an unqualified list as a ranking.
5. Every number on the board is reproducible from `trades`, `asset_transfers`, `markets`, `market_stats` at a stated block.

## 2. Local data reality (queried 2026-11-26)

40 non-orphaned trades, 8 traders, 2 markets (both `trading`), 0 venue swaps, 42 transfers, 6 protocol accounts. Median trade 0.0012 WETH, p10 ~0.00001, p90 0.0425. 17 of 40 trades are below 0.001 WETH. One wallet has 22 of 40 trades and it is the creator of one market and the `treasury` protocol account (`is_user_attributable=false`). Only one wallet touches 2+ markets. One trade lands in its market's launch block.

Consequence: thresholds below are set for mainnet-scale growth, and with today's data **the ranked board will be empty by design**. That is the correct outcome and is why section 8 matters.

## 3. Threat model

| # | Vector | Today | Countermeasure (data in this DB) |
|---|---|---|---|
| T1 | Tiny base, huge % (0.001 WETH to +400%) | Fallback sorts by `return_bps` with `trade_count>0` | Sort by shrunken absolute score (s6); min capital gate; min non-dust trades |
| T2 | Wash / self-trading across own wallets | None | Cluster detection (s5.4): shared funding source, counterpart round trips, same-block buy/sell pairs. Cluster members are pooled into one entity; only the best member can rank, and intra-cluster-attributed P&L is dropped |
| T3 | Creator trades own token | Creator rows counted | Exclude all trades where `trader_address = markets.creator_address` for that token, from P&L, markets, trade counts and denominators. Also exclude creator-linked wallets (cluster) |
| T4 | Insider/launch-block buys | Not handled | Trades in `launch_block`..`launch_block+N` (N=2 blocks) and anti-snipe-taxed buys (`anti_snipe_tax_quote>0`) are included in P&L but **flagged**; a wallet with >50% of capital in launch-window buys across its markets is excluded from "Track record" (insider-like). Creator-funded wallets are clustered (T2) |
| T5 | Pump thin market to mark up open position | Spot mark | Mark open balance at **simulated exit** through the curve (s4.2), which prices own impact. Plus a market-depth gate (s5.2). Ranking uses realized P&L plus haircut exit mark, so a pump the wallet cannot sell into earns nothing |
| T6 | Last-minute push before publish | Spot at publish | Mark with a **TWAP** of market price over the trailing 6h (trade-weighted by time, from `trades.virtual_*_after`), capped at the lower of TWAP-exit and current-exit. Publish only from a snapshot at a block >= 20 confirmations old |
| T7 | Transfers out to park a bad position or relocate a good one | Fallback ignores; main path excludes wallets with outbound transfers | Position-level treatment (s4.4): tokens leaving a wallet other than via a sell are treated as a sale at **zero proceeds** (loss realized at basis) unless the destination is the same cluster, in which case wallet is merged. Gaming by "move winner to fresh wallet" is neutralized because transferred-in tokens have unknown basis and earn nothing |
| T8 | Airdropped / unknown-basis tokens | Capped by `known_basis_token_balance` | Keep: only tokens bought on curve carry basis. Transferred-in tokens count at 0 value for exit mark and 0 cost. Selling them yields `unknown_basis_tokens_sold`, proceeds excluded from P&L |
| T9 | Survivorship (abandon losers, new wallet) | n/a | Not preventable. Mitigate: min history (s5), and never rank a wallet that has a cluster-linked sibling with worse P&L (cluster pooling takes the sum) |
| T10 | Single-market luck | `market_count>=2` | Max 60% of positive P&L from one market (s5), min 3 markets for Track record |
| T11 | Dust trades to satisfy counts | Count thresholds only | A "qualifying trade" requires net quote >= 0.005 WETH (and >= 1% of wallet's median-or-peak capital to stop 1 big + n dust). Days/markets counted from qualifying trades only |
| T12 | Graduated pool pricing | `venue_swaps` empty, curve price used | Graduated markets: curve is closed, so mark = last pool TWAP from `venue_swaps.price_x18` only if pool has >= 5 distinct swappers and 24h of history; else realized only. Pool swaps by wallet count only if indexed; otherwise exclude graduated-market positions from the mark |
| T13 | Protocol/keeper accounts | `protocol_accounts.is_user_attributable=false` excluded | Keep, plus exclude any wallet that is the `funder` of keeper roles; treasury seen trading as creator confirms the need |
| T14 | Sybil-follow inflation for "followers" category | Followers need >=1 trade | Out of scope for P&L ranking; followers category must never be labelled a performance ranking |

## 4. Metric definitions

All amounts are `uint256` wei strings, processed as `BigInt` in JS or `numeric` in SQL. Never `Number` on wei. Ratios in **bps** (integer, rounded toward zero for display, floor for scoring so we never overstate). Round proceeds and exit values **down**, cost **up** (protocol-conservative: `ceil` basis when allocating cost to sells).

### 4.1 Realized P&L (per wallet, per market, creator-own excluded)

Keep average-cost method already in `rebuildCurvePosition`. `realized_pnl = known_proceeds - removed_cost`, proceeds being `net_trader_quote` (already after fee and creator tax, so costs are in). Fix: `removedCost` currently floors; use ceil for removed cost.

### 4.2 Exit-value mark (unrealized)

For balance `b` = `min(known_basis_balance, onchain transfer-adjusted balance)` in market with `vQ, vT, realQuote, feeBps, taxBps` taken from `market_stats` at the as-of block:

```
gross = floor(vQ * b / (vT + b))            -- constant product, mirrors CurveMath.quoteSell
gross = min(gross, realQuote)               -- curve cannot pay more than real reserves
exit  = floor(gross * (10000 - feeBps - taxBps) / 10000)
mark  = min(exit_now, exit_at_TWAP_state)    -- T6
```
Implementation must call or port `CurveMath.quoteSell` exactly and be test-vectored against `previewSell` on a fork. Markets with null/zero reserves, or last trade older than 7 days with `b` > 0, mark at **0 value**, not -100% of cost via price=0, and are flagged `staleMark`. Rationale: a stale or unpriceable position is excluded from upside but its cost remains (conservative). `0xc823...`-style frozen values disappear because marks are recomputed (s7).

### 4.3 Capital denominator

`peak_capital` = max over time of (sum of remaining cost basis across open positions + realized cost of positions closed in the trailing window not yet re-deployed), approximated as the running maximum of **net capital deployed** `max_t( cumulative_buys_t - cumulative_sell_cost_basis_t )`. Recycled capital is not double counted. Computed by replaying trades in order (same loop as `rebuildCurvePosition`, aggregated across markets). Stored as `peak_capital_quote`.

### 4.4 Transfers

Outbound non-sell transfer of `x` tokens from a basis-carrying position: realize as sale at 0 proceeds (`realized -= basis*x/balance`). Transfer to same-cluster wallet: cluster is merged, transfer is internal (no P&L event). Inbound: no basis, no value (T8).

### 4.5 Display metrics (not ranking)

`netPnlWei = realized + exitMark`, `returnBps = netPnl*10000/peak_capital` (floor), `realizedOnlyPnlWei`, `winRate` over closed markets, `peakCapitalWei`, `staleMarkCount`, `exitMarkShareBps = exitMark / (|realized|+|exitMark|)`.

## 5. Eligibility

### 5.1 Common gates (all P&L categories)

- Not in `protocol_accounts` (any role), not blocked, not creator-linked to any market they hold (T3 via exclusion of trades, not wallet).
- Not in a flagged cluster as a non-representative member (5.4).
- `peak_capital >= 0.02 WETH` (current wallets peak at 0.084 WETH; top is 0.0840, so 0.02 keeps 4 of 8 today and filters sub-0.01 dust accounts).
- Qualifying trades (>= 0.005 WETH net) only count toward thresholds.

### 5.2 Market depth gate

A market's position contributes to the **exit mark** only if market virtual quote (`vQ`) >= 0.5 WETH and `unique_trader_count >= 5` excluding the wallet's cluster. Otherwise it contributes at realized-only. Prevents T5 on markets one wallet owns.

### 5.3 Category gates

| Category | Window | Qualifying trades | Distinct markets | Distinct active days | Other |
|---|---|---|---|---|---|
| Track record (`consistent`) | all-time P&L, but last qualifying trade within 30d | >= 10 | >= 3 | >= 5 | first trade >= 14d old; max 60% of positive P&L from one market; launch-window share <= 50%; peak capital >= 0.05 WETH |
| Emerging (`new`) | trades from last 14d only; positions opened before window are marked at window-start exit value as basis (s5.5) | >= 5 | >= 2 | >= 3 | account first trade <= 14d old; peak capital >= 0.02 WETH |
| Trending (`trending`) | 7d | >= 4 | >= 2 | >= 3 | **rank by 7d windowed P&L**, not breadth score; positive 7d net P&L; no stale marks |
| Followers (`followers`) | 30d | >= 2 | n/a | >= 2 | Social metric; labelled "most followed", never "best traders"; followers must hold >= 0.005 WETH qualifying volume and be account-age >= 7d |

Track record and Emerging become disjoint by construction (Emerging requires first trade within 14d; Track record requires >= 14d).

### 5.4 Cluster detection (data in DB)

Link wallets A,B when any holds:
1. Same first-funder: the address that first sent native/WETH to each wallet (needs a funding-source indexer addition; if absent, fall back to 2 and 3).
2. Round-trips: >= 3 token transfers between A and B in `asset_transfers`, or A sells and B buys the same token in the same block or adjacent blocks, repeated >= 2 times.
3. Same-block opposing legs: A buys and B sells (or reverse) within 2 blocks in the same market with amounts within 5%, >= 2 occurrences.

Cluster = connected component. Score the cluster as a single entity: sum of P&L, shared peak capital, and the highest-ranked member represents it; others are hidden from ranked categories. Wash P&L is neutral in the sum anyway because fees leak (about 0.75% per leg plus creator tax), so pooling removes the incentive. Reported as `clusterSize` in metrics.

### 5.5 Windowed cost basis

For a window starting at `S`: opening positions are re-based at the **exit value at S** (from stored market_stats history or recomputed via `trades.virtual_*_after` at last trade before S). P&L in window = realized sells within window (against re-based cost) + exit mark at as-of minus opening mark. This keeps recent categories recent while not rewarding pre-window gains.

## 6. Ranking score

Per entity, with `P` = net P&L (realized + exit mark, wei), `C` = peak capital, `n` = qualifying trades:

```
r        = P / C                                     (fractional return)
score    = P * n / (n + k)  - lambda * max(0, -P_realized_drawdown)   (shrinkage on sample size)
```
Concretely: `score_wei = floor( P * n / (n + 8) )`, ranking by `score_wei` DESC. k=8 means a 10-trade wallet keeps 56% of its P&L and a 40-trade wallet 83%. Absolute (not percent) P&L gives no advantage to small-base accounts; shrinkage penalises thin samples. A 0.001 WETH wallet cannot outrank a 0.05 WETH wallet on luck.

Tie-breaks in order: higher realized-only P&L, higher qualifying trade count, earlier first trade, address ASC (deterministic). Show `returnBps` and a confidence label (`established` n>=25, `developing` n>=10, `new`).

Open-position cap: exit mark may contribute at most 50% of `P` to score; excess above is shown but not scored (limits "paper winner" rankings).

## 7. Freshness

- Replace per-wallet-on-own-trade refresh with **publish-time recompute**: `publishLeaderboards` recomputes exit marks for all candidates at `as_of_block` from current `market_stats` and `trades` (cheap at current scale; revisit with a materialized per-market exit-curve if wallets > 10k).
- Triggers: after every indexer batch with any trade or transfer (coalesced to at most once per 60s), plus a 5-minute cron so prices decay and staleness gates trip without activity.
- `as_of_block` must be finalized depth >= 20 blocks (T6). Snapshot rows record `as_of_block`, `as_of_time`, `methodology_version`.
- Staleness guard: if latest published snapshot is older than 15 minutes, API sets `stale: true`; UI shows "Updated N min ago". Over 60 minutes, UI collapses to "Rankings paused".
- Per-wallet `refreshPerformanceSnapshot` stays only as a cache of realized and basis fields; marks are never read from it at publish.

## 8. Empty and provisional behavior

- Delete the `provisionalLeaderboardSql` fallback for ranked categories. No DISTINCT ON across methodology versions anywhere.
- API when nobody qualifies: `{ category, status: "no_qualifiers", methodologyVersion, asOfBlock, items: [], progress: [...] }`. `progress` returns up to 5 near-qualifiers **anonymised to counts** ("3 wallets meet 2 of 4 requirements") or, optionally, an unranked "Watching" list.
- Optional `status: "provisional"` list is allowed only if rows carry `rank: null`, are sorted by **activity (trade count) not P&L**, and the response has `provisional: true`.
- UI (`src/social/PulseTraders.tsx`, `SocialPage.tsx`): must branch on `status`. For `no_qualifiers` show the requirements checklist ("10 trades of 0.005+ WETH, 3 markets, 5 active days") and the "How ranking works" link, no ranked rows, no percentages. Provisional rows render without rank numbers and with a visible "Not ranked" badge.
- Same wallet cannot appear in both Track record and Emerging (disjoint gates, s5.3).

## 9. Versioning and transparency

- `PERFORMANCE_METHODOLOGY = "curve-exit-realized-v3"`; snapshots and rows persist it; API only serves rows matching the current version (as now) and never mixes versions.
- Rule constants (thresholds, k, haircuts) move into one frozen object and are emitted in `GET /pulse/leaderboards/:category` as `rules`, so UI text is generated from them and cannot drift.
- "How ranking works" panel (5 lines): profit not percent; open positions valued at what selling them would actually return; your own token and linked wallets are excluded; minimum sample sizes; updated every few minutes at a stated block.
- Per-row disclosure: `realized` vs `open value`, `staleMarkCount`, `clusterSize`, confidence label, as-of time.
- Do not publish exact cluster heuristics or thresholds for flags beyond eligibility numbers (keeps evasion costly). Thresholds are public; detection internals are not.
- Changelog entry in `docs/` for every version bump; old snapshots retained, never rewritten.

## 10. Implementation order (for later, not now)

1. Exit-mark and peak-capital functions with unit vectors against `previewSell` (pure, BigInt) in `performance.mjs`.
2. Creator-own-trade exclusion and qualifying-trade gating in `rebuildCurvePosition` and the candidate SQL.
3. Remove provisional fallback; add `status` contract; UI empty state.
4. Publish-time recompute and scheduler.
5. Windowed basis (Emerging/Trending).
6. Cluster detection (starts with transfer and same-block heuristics; funding-source needs an indexer addition).
7. Tests: wash round trip does not rank, thin-market pump does not rank, creator-only wallet excluded, transfer-out realizes loss, stale price yields no -100%, empty board returns `no_qualifiers`, plus a Postgres-backed invariant test: sum of per-market P&L equals wallet P&L.

## 11. Not solving / residual risks

- Fresh-wallet sybils funded from unrelated CEX withdrawals: undetectable on-chain; partially priced out by 0.75% fee per leg plus min capital and history gates.
- Survivorship: a farmer can run N wallets and publish only winners. Gates raise the cost; they cannot prevent it.
- Coordinated real-money pumps among colluding but unlinked wallets: exit-mark and depth gates blunt paper gains but not realized profit from a genuine pump-and-dump. Realized profit from a dump into others' liquidity is indistinguishable from skill.
- Off-curve venues before indexer support (`venue_swaps` currently empty): activity there is invisible, so wallets may look better or worse than reality.
- Insider knowledge (private launch info) is not observable.
- Small-n statistics: with a handful of wallets, rankings are noisy even if honest. Labelled via confidence.
- The board shows past performance; it is not an endorsement or safe-to-follow signal.

## 12. Owner decisions (2026-11-26)

1. **Capital floor:** keep the spec values, 0.02 WETH peak capital for P&L categories and 0.05 WETH for Track record.
2. **Empty board:** show the requirements checklist plus an unranked "Watching" list. Rows have `rank: null`, are sorted by activity (never P&L), carry a visible "Not ranked" badge, and the response sets `status: "no_qualifiers"` with `provisional: true` on those rows. No percentages on Watching rows.
3. **Linked-wallet grouping (section 5.4) is deferred to a follow-up change.** Do not build cluster detection, funding-source indexing, or `clusterSize` in this change. Everything else in this spec ships now, including transfer handling (section 4.4) and creator-own-token exclusion. Leave a clear seam (for example an entity id that is the wallet address today) so clustering can be added without reworking ranking.
