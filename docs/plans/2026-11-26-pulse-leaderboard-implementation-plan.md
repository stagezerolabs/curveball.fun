# Pulse Leaderboard v3 (`curve-exit-realized-v3`): Implementation Plan

## Context

**Goal.** Replace the `curve-known-basis-v2` trader leaderboard with the methodology in `docs/plans/2026-11-26-pulse-leaderboard-methodology.md` (the "spec"): rank on realized P&L plus a conservative, executable exit-value mark for open positions, sort by shrunken absolute profit (never percent), and never show an unqualified fallback as a ranking.

**Owner decisions (spec section 12) override earlier sections:**
1. Capital floors: 0.02 WETH peak capital for all P&L categories, 0.05 WETH for Track record (`consistent`).
2. Empty board: `status: "no_qualifiers"` with a requirements checklist plus an unranked "Watching" list (rows `rank: null`, `provisional: true`, sorted by activity, "Not ranked" badge, no percentages).
3. **Out of scope: linked-wallet clustering (spec 5.4), funding-source indexing, `clusterSize`.** Leave a seam: every evaluation carries `entityId` (= wallet address today) and ranking groups by `entityId`.

Transfer handling (4.4), creator-own-token exclusion, exit marks, TWAP, publish-time recompute, freshness, the status contract, and UI all ship.

**Current code facts (verify line numbers before editing):**
- `services/backend/src/analytics/performance.mjs`: `refreshPerformanceSnapshot` (~L29-81) marks at spot; `publishLeaderboards` (~L121-260) builds SQL from `scoreExpressions`/`eligibleExpressions` (~L83-119) and reads v1+v2 snapshots (~L163).
- `services/backend/src/api/features/pulse/leaderboards.mjs`: `leaderboards()` (~L35-107) falls back to `provisionalBoard()` (~L111-158) using `provisionalLeaderboardSql` (`pulseSql.mjs` ~L73-82, sorts by `return_bps`).
- `services/backend/src/indexing/indexer.mjs`: `rebuildCurvePosition` (~L168-255, average cost, floors `removedCost` ~L198); `indexTradeRange` calls `refreshPerformanceSnapshot` + `publishLeaderboards` inside its transaction (~L1015-1018); `indexLedgerRange` likewise (~L1260-1262). Only scheduler: the `tick` loop in `startIndexer` (~L1485-1563) using `setTimeout(tick, config.pollIntervalMs)`.
- Curve math: `CurveMath.quoteSell` in `contracts/contracts/libraries/CurveMath.sol` (~L89-102), used by `CurveLaunchpad.previewSell` (~L338-341). No JS port exists (`src/sdk/sdk.ts:606` only calls `previewSell` over RPC). `realQuote` is not indexed, but the contract guarantees `realQuote == virtualQuote - initialVirtualQuote` pre-graduation (`CurveLaunchpad.sol` ~L84), so derive it from `markets.initial_virtual_quote`.
- Tests: no real-Postgres harness; backend tests use a recording fake `db` (`services/backend/tests/analytics/performance.test.mjs`). **Strategy: put all ranking logic in pure BigInt modules fed by one bulk load at publish time**, plus one opt-in Postgres test (Task 7).
- Frontend: `src/pages/SocialPage.tsx` (~L60) hard-codes `board = "consistent"`, so only Track record is shown.

**Architecture decision.** Keep `curve_positions` and `refreshPerformanceSnapshot` (the profile API reads `curve_positions`: `api/features/social/profile.mjs` ~L24, 84, 112). Pin `refreshPerformanceSnapshot` to its own label `curve-known-basis-v2` so its rows are never mislabelled v3. All v3 numbers come from a new pure engine that replays raw `trades` + `asset_transfers` up to `asOfBlock`.

## Ground rules for the executor

- Work in this worktree: `/Users/macbook/Desktop/projects/curveball-leaderboard-v3` on branch `feat/leaderboard-v3-methodology` (already created from `main` at `1f02dfc`; `.env` is a symlink to the main checkout's ignored `.env`). Run `bun install` first if `node_modules` is missing. **Never touch the main checkout** (`/Users/macbook/Desktop/projects/curveball.fun`); it has unrelated uncommitted UI edits.
- Test-first for every task: write the failing test, run it and see it fail, then implement.
- One commit per task, short imperative summary, ending with the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Wei is always `BigInt` in JS and `numeric` in SQL. Never `Number(wei)`. Two-space indentation, double quotes.
- Backend tests live in `services/backend/tests/analytics/` and use the env preamble from `performance.test.mjs` (~L1-11) only when importing modules that load `platform/config.mjs`. Pure modules must not import config.

## Tasks

### Task 1: Rules object and exact curve exit (`curveExit.mjs`)

**Files:** new `services/backend/src/analytics/leaderboardRules.mjs`, new `services/backend/src/analytics/curveExit.mjs`, new `services/backend/tests/analytics/curveExit.test.mjs`.

**Behavior:**
- `LEADERBOARD_RULES_V3 = Object.freeze({...})` holds every threshold (wei as strings): qualifying trade 0.005 WETH and >= 1% of peak capital; peak capital floor 0.02 WETH (Track record 0.05); Track record 10 trades / 3 markets / 5 days / first trade >= 14d old / last trade <= 30d / single-market share <= 6000 bps of positive P&L / launch-window share <= 5000 bps; Emerging 5 / 2 / 3 / first trade <= 14d; Trending 7d window, 4 / 2 / 3; Followers 30d, 2 trades, 2 days, 0.005 WETH follower volume, follower account >= 7d; shrinkage `k = 8`; open-position share cap 5000 bps; TWAP 6h; stale market 7d; depth gate real quote >= 0.5 WETH and >= 5 other traders; launch window 2 blocks; publish depth 20 blocks; publish interval 60s, cron 300s; API stale 15 min, paused 60 min; confidence `established` n >= 25, `developing` n >= 10.
- `publicRules(category)` returns only checklist and score numbers (trades, markets, days, min trade size, capital, history, recency, `k`, open cap). Depth-gate and launch-window internals stay unexported (spec 9).
- `quoteSellExact({ vT, vQ, realQuote, amount, feeBps, taxBps })` is a line-for-line port of `CurveMath.quoteSell`: `gross = vQ - ceilDiv(vT*vQ, vT+amount)`; `fee = gross*feeBps/10000n` and `tax = gross*taxBps/10000n`, each floored separately; `net = gross - fee - tax`. Returns `{ net, gross, fee, tax, error }` with `error` in `"InvalidAmount" | "ZeroOutput" | "InsufficientReserve" | "DustTrade" | null`. Never throws.
- `exitValue(...)` is the ranking mark: 0 for zero/null reserves or `amount == 0`; if `gross > realQuote`, clamp gross to `realQuote` then apply fee and tax; if `feeBps > 0` and the fee floors to 0, return 0 (unsellable dust).

**Failing tests first** (fee 75 bps, creator tax 31 bps, `E = 10n**18n`):
- `quoteSellExact matches CurveMath for a mid-curve sell`: `vT = 900000000n*E`, `vQ = 1111111111111111112n`, `realQuote = 111111111111111112n`, `amount = 10000000n*E` gives `gross = 12210012210012210n`, `fee = 91575091575091n`, `tax = 37851037851037n`, `net = 12080586080586082n`. Comment: the spec's combined `floor(gross*(10000-106)/10000)` gives `...080`, 2 wei low; the contract wins.
- `quoteSellExact matches local CURVE market state`: `vT = 764855631800017662035096229n`, `vQ = 1307436277414329312n`, `realQuote = vQ - E`, `amount = 10000000n*E`, fee 75, tax 0 gives `gross = 16873288697368147n`, `net = 16746739032137886n`.
- `exitValue clamps to real reserves`: `vT = 1000000000n*E`, `vQ = E+1n`, `realQuote = 1n`, `amount = 1000000n*E`; `quoteSellExact` gives `error = "InsufficientReserve"` (gross `999000999000999n`); `exitValue` gives `0n` (clamped gross 1, fee 0, dust).
- `exitValue of a dust amount is zero`: first-test reserves, `amount = 100000000000n` gives gross 123, fee 0, `error = "DustTrade"`; `exitValue = 0n`.
- `exitValue treats null or zero reserves as zero`.
- `rules object is frozen and publicRules hides internals`.

**Verify:** `bun test services/backend/tests/analytics/curveExit.test.mjs`

### Task 2: TWAP state and the conservative mark

**Files:** `curveExit.mjs`, `curveExit.test.mjs`.

**Behavior:**
- `twapVirtualQuote(states, asOfTime, windowSec)`: `states` is an ordered array of `{ at: epochSec, vQ, vT }` from `trades.virtual_*_after`, including the last state before the window start (or the launch state from `initial_virtual_quote` / `total_supply` if none). Returns the floored time-weighted average `vQ` over `[asOf - window, asOf]`; if the market launched inside the window, the window starts at launch.
- `markPosition({ amount, now: {vT, vQ, realQuote}, states, initialVirtualQuote, feeBps, taxBps, asOfTime })`: `kNow = vT*vQ`; `vQt = twapVirtualQuote(...)`; `vTt = ceilDiv(kNow, vQt)`; `realQuoteT = max(0, vQt - initialVirtualQuote)`; return `min(exitValue(now), exitValue(twapState))`.

**Failing tests:**
- `TWAP averages vQ over time`: 1e18 for the first 3h, 1.2e18 for the last 3h gives `1100000000000000000n`.
- `mark is the lower of current and TWAP exit`: `k = (900000000n*E)*1111111111111111112n`; current `vQ = 12n*E/10n`, `vT = ceilDiv(k, vQ)`; window history as above; `amount = 10000000n*E`, fee 75, tax 31, `initialVirtualQuote = E`. Exit now = `14078418972332017n`; TWAP state `vT = 909090909090909091636363637n` gives exit `11841483679525223n`; expect mark `11841483679525223n` (the last-minute-pump guard).
- `TWAP uses the launch state when the market is younger than the window`.

**Verify:** same test file.

### Task 3: Position replay, transfers, peak capital (`positionLedger.mjs`)

**Files:** new `services/backend/src/analytics/positionLedger.mjs`, new `services/backend/tests/analytics/positionLedger.test.mjs`.

**Behavior.** `replayWallet({ wallet, events, launchpadAddress, creatorByToken })`, where `events` are the wallet's trades and transfers across all markets sorted by `(block_number, transaction_index, log_index)`. Per-token state follows `rebuildCurvePosition` with these changes:
1. **Creator-own exclusion:** skip all trades and transfers in a token where `wallet == creatorByToken[token]`; count them in `excludedCreatorTrades`.
2. **Removed cost rounds up:** `removedCost = min(remainingCost, ceilDiv(remainingCost*knownSold, knownBalance))`. Known proceeds stay floored.
3. **Transfers:** skip transfers with `from == launchpad` or `to == launchpad` (curve legs of buys/sells). **Outbound** (`from == wallet`, any other destination including 0x0 and pools): `xKnown = min(x, knownBalance)`; realize a sale at zero proceeds (`realized -= removedCost`, `realizedCost += removedCost`, `transferOutCount++`), known-basis tokens leaving first as for sells. **Inbound:** only `onchainBalance += x`; adds no basis and no value.
4. Track `onchainBalance` from transfers only. Markable balance = `min(knownBalance, max(0, onchainBalance))`.

**Peak capital**, one pass across all markets in event order: `deployed += buyQuote` on buys, `deployed -= removedCost` on sells and transfer-outs; `peakCapital = max(deployed)`.

Returns `{ entityId: wallet, perToken: Map<token, {knownBalance, markableBalance, remainingCost, realizedPnl, realizedCost, invested, tradeCount, unknownSold, transferOutCount}>, peakCapital, trades }`.

**Failing tests:**
- `removed cost rounds up and sums to basis`: buy 3 tokens for 100 wei, sell 1, 1, 1; removed costs 34, 33, 33, total 100 (old floor gave 33 first).
- `peak capital does not double count recycled capital`: buy A 0.05 WETH (1000 tokens), buy B 0.03, sell 400 A for 0.03 (removed 0.02, realized +0.01), buy C 0.04; `peakCapital = 100000000000000000n` (0.10, not 0.12).
- `transfer-out realizes a loss at zero proceeds`: buy 1000 for 0.05, transfer 500 away; `realizedPnl = -25000000000000000n`, `remainingCost = 25000000000000000n`, `knownBalance = 500`, `transferOutCount = 1`.
- `recipient of transferred tokens earns nothing`: recipient sells those 500 on the curve for 0.03; `realizedPnl = 0n`, `unknownSold = 500`.
- `curve sell legs are not double counted as transfers`: a sell plus its wallet-to-launchpad transfer in the same tx realize exactly once.
- `creator-own trades are excluded`.
- `sum of per-token realized P&L equals wallet realized P&L` (invariant over the fixtures above).

**Verify:** `bun test services/backend/tests/analytics/positionLedger.test.mjs`

### Task 4: Score, open-position cap, tie-breaks (`rankingScore.mjs`)

**Files:** new `services/backend/src/analytics/rankingScore.mjs` and test.

**Behavior:**
- `shrunkScore(P, n, k = 8n) = floorDiv(P*n, n+k)` with floor toward negative infinity.
- `scoredPnl(realized, unrealized)`: if `unrealized <= 0` return `realized + unrealized`; else `realized + min(unrealized, max(realized, 0n))` (open positions supply at most 50% of P; no realized profit means no open upside).
- `compareEntities(a, b)`: score desc, realized P&L desc, qualifying trades desc, earlier first trade, address asc.
- `confidenceLabel(n)`: `established` n >= 25, `developing` n >= 10, else `new`.
- `returnBps(P, C) = floorDiv(P*10000n, C)`, or `null` when `C == 0`.

**Failing tests:**
- `shrunkScore(10n**17n, 10n) === 55555555555555555n`; `shrunkScore(10n**17n, 40n) === 83333333333333333n`; `shrunkScore(-(10n**17n), 10n) === -55555555555555556n`; `shrunkScore(x, 0n) === 0n`.
- `scoredPnl(0.01e18, 0.05e18) === 0.02e18`; `scoredPnl(0n, 0.05e18) === 0n`; `scoredPnl(0.03e18, -0.01e18) === 0.02e18` (BigInt literals).
- `a small-base wallet cannot outrank a larger profit`: A has P = 0.0008 WETH from a 0.001 base (+80%), n = 40; B has P = 0.01 from 0.05 (+20%), n = 10; B ranks first.
- `tie-break order is deterministic`.

### Task 5: Wallet evaluation, eligibility gates, Watching (`leaderboardEngine.mjs`)

**Files:** new `services/backend/src/analytics/leaderboardEngine.mjs`, test `leaderboardEngine.test.mjs` (holds the adversarial tests).

**Behavior.** Pure `evaluateLeaderboards({ asOfBlock, asOfTime, markets, statesByToken, trades, transfers, protocolAccounts, follows, rules })` returns `{ categories: { consistent, new, trending, followers }, evaluations }`. `markets` per token: `creator, launchBlock, initialVirtualQuote, feeBps, creatorTaxBps, state, vQ, vT, latestTradeAt, uniqueTraders`. `trades` and `transfers` are already filtered to `block_number <= asOfBlock` and `orphaned = false`.

Per wallet:
- **Exclusions:** skip any address in `protocolAccounts` with any role (not only `is_user_attributable = false`). Run `replayWallet`.
- **Qualifying trade:** kept trade with `net_trader_quote >= 0.005 WETH` and `>= floorDiv(peakCapital, 100)`. Trades, distinct markets, and active days count qualifying trades only. Active days = distinct `floor((t - firstQualifyingTradeAt) / 86400)` (same convention as `performance.mjs` ~L171-177).
- **Mark per token:** if `state` is `trading` or `aborted`, `markableBalance > 0`, reserves present, and `latestTradeAt` within 7 days, use `markPosition(...)`. Otherwise exclude the exit value: unrealized 0, `staleMarkCount++` (covers `ready`/`graduated` with no pool pricing yet since `venue_swaps` is empty, and null/zero/stale reserves); cost stays in peak capital.
- **Depth gate:** apply the mark only if `vQ - initialVirtualQuote >= 0.5 WETH` and the market has >= 5 non-protocol traders other than this wallet; otherwise the token is realized-only with a `thinMarket` flag.
- `unrealized = mark - ceil(remainingCost*markable / knownBalance)` (round cost up).
- **Metrics:** `realizedPnlWei, openValueWei, unrealizedPnlWei, netPnlWei, scoredPnlWei, peakCapitalWei, returnBps, qualifyingTradeCount, marketCount, activeDayCount, staleMarkCount, transferOutCount, exitMarkShareBps, confidence, firstTradeAt, lastTradeAt, perMarket[]`.
- **Launch-window share:** buy quote with `block_number <= launch_block + 2` or `anti_snipe_tax_quote > 0`, over total buy quote, in bps.
- **Single-market share:** `max(positive per-market scored P) * 10000 <= 6000 * sum(positive per-market scored P)`.

Category gates: spec 5.3 with section 12 floors. **All P&L categories also require `scoredPnl > 0`.** Track record requires first trade >= 14d old and Emerging <= 14d, so they are disjoint. Trending is all-time here; Task 10 switches it to the windowed basis. Followers keeps its social gates; score = eligible follower count.

Ranked categories group by `entityId`, sort by `compareEntities`, keep top 100. If a ranked category is empty: `status = "no_qualifiers"`; `watching` holds up to 10 rows `{ address, rank: null, provisional: true, qualifyingTradeCount, marketCount, activeDayCount, requirementsMet, requirementsTotal, lastTradeAt }` from wallets with >= 1 qualifying non-creator trade, sorted by qualifying trades desc, `lastTradeAt` desc, address; **no P&L or percent field**. `progress` holds anonymised counts `[{ requirementsMet, requirementsTotal, walletCount }]`.

**Failing tests** (spec 10.7 minus clustering; build fixtures with helper factories):
- `wash round-trip does not rank`: 12 buy-and-immediate-sell round trips of 0.05 WETH across 3 markets over 6 days with >= 14 days history and real fees; realized is negative; absent from `consistent`; `consistent.status === "no_qualifiers"`.
- `thin-market pump does not rank`: buys 0.1 WETH in a market with 2 traders and real quote 0.3 WETH, price triples; `openValueWei` not scored (`thinMarket`), `scoredPnl <= 0`, not ranked. Variant: deep market, unrealized gain only; `scoredPnl === realized === 0`; not ranked.
- `creator-only wallet is excluded`: only trades its own token; in no category, not in `watching`, not counted in `progress`.
- `transfer-out realizes the loss`: a would-rank wallet moves a losing position out; `netPnlWei` drops by the removed basis; `transferOutCount === 1`.
- `stale price never yields -100%`: a single 0.05 WETH position in a market last traded 8 days ago gives `netPnlWei === "0"`, `returnBps === 0`, `staleMarkCount === 1`, `openValueWei === "0"`.
- `empty board returns no_qualifiers with Watching sorted by activity`: three sub-threshold wallets with 6, 3, 1 qualifying trades are ordered by trade count even when the 1-trade wallet has the highest P&L; rows have `rank: null`, `provisional: true`, and no `returnBps` or `netPnlWei` key.
- `sum of per-market P&L equals wallet P&L`: for every evaluation, `sum(perMarket.realized + perMarket.unrealized) === netPnl` and `sum(perMarket.scored) === scoredPnl`.
- `Track record and Emerging are disjoint`.
- `protocol accounts never appear`.
- `peak capital floors`: 0.049 WETH rejected from `consistent`; 0.02 WETH accepted for `new`.
- `launch-window-heavy wallet is excluded from Track record`.
- `a wallet with 70% of positive P&L from one market is excluded from Track record`.

**Verify:** `bun test services/backend/tests/analytics/leaderboardEngine.test.mjs`

### Task 6: Migration (forward-only, additive)

**Files:** `packages/db/src/schema.ts` (`leaderboardSnapshots`, ~L715-747), generated `packages/db/drizzle/0013_*.sql`, `meta/0013_snapshot.json`, `meta/_journal.json`.

**Change.** Add to `leaderboard_snapshots`: `status text NOT NULL DEFAULT 'ranked'` with CHECK `status in ('ranked','no_qualifiers')`; `as_of_time timestamptz`; `details jsonb NOT NULL DEFAULT '{}'` (holds `rules`, `watching`, `progress`). Watching rows live in `details`, not `leaderboard_rows`, so the `rank NOT NULL` / `rank > 0` constraint (`schema.ts` ~L765-768) stays.

**No backfill.** v1/v2 snapshots keep the default `'ranked'` and are retained, never rewritten; the API filters by version (Task 9). v3 rows come from the first publish after deploy (full replay from raw tables); no rebuild script. `curve_positions` and `trader_performance_snapshots` unchanged.

**Generate** with `bun run db:generate`; inspect the SQL and confirm it is only `ADD COLUMN` / `ADD CONSTRAINT`; keep drizzle's generated name.

**Test:** extend a schema assertion if one exists; otherwise `bun run --cwd packages/db check`, then `make docker-mainnet-rebuild` (runs the migrate job against the LOCAL database only), then `docker exec curveball-mainnet-postgres-1 psql -U curveball -d curveball -c '\d curveball.leaderboard_snapshots'`. Commit the migration on its own.

### Task 7: Rewrite `publishLeaderboards` around the engine

**Files:** `services/backend/src/analytics/performance.mjs`, `tests/analytics/performance.test.mjs` (rewrite), new opt-in `tests/analytics/leaderboardDb.test.mjs`, new `services/backend/src/entrypoints/leaderboardReport.mjs`.

**Behavior:**
- Constants: `PERFORMANCE_METHODOLOGY = "curve-exit-realized-v3"` (leaderboards); `PERFORMANCE_SNAPSHOT_METHODOLOGY = "curve-known-basis-v2"` used only by `refreshPerformanceSnapshot` (~L79), otherwise unchanged. Delete v2 `LEADERBOARD_RULES`, `scoreExpressions`, `eligibleExpressions`, `methodologyCaveat`.
- `loadLeaderboardInputs(db, asOfBlock)`: a few bulk read-only queries: markets joined to `market_stats`; per-market `(block_timestamp, virtual_quote_after, virtual_token_after)` from the last trade before `asOf - 6h` onward; `trades` and `asset_transfers` (token in markets, `block_number <= asOfBlock`, `orphaned = false`) ordered by `block_number, transaction_index NULLS LAST, log_index`; `protocol_accounts`; `follows`.
- `publishLeaderboards(db, asOfBlock, asOfTime = new Date())`: load inputs, call `evaluateLeaderboards`, then in one transaction per category upsert the snapshot (the existing ON CONFLICT shape ~L126-130 plus `status`, `as_of_time`, `details`), delete old rows, insert ranked rows with `score` = shrunk scored P&L and `metrics`. Return a summary for logging (`durationMs`, wallet and category counts).
- Retention: after publishing, delete v3 snapshots older than 7 days except the latest per category. Never delete other versions.
- `leaderboardReport.mjs`: read-only CLI `bun services/backend/src/entrypoints/leaderboardReport.mjs <asOfBlock> <address...>` printing each address's full evaluation including per-market rows, for manual verification.

**Failing tests** (recording fake db):
- `publishes v3 snapshots with status and details`: SQL contains `status`, `details`, `as_of_time`; version value is `curve-exit-realized-v3`.
- `never reads mixed methodology versions`: no query text contains `curve-known-basis-v1` or `DISTINCT ON`.
- `refreshPerformanceSnapshot keeps the v2 label`.
- `retention only prunes v3`.
- Opt-in Postgres invariant (`test.skipIf(!process.env.CURVEBALL_TEST_DATABASE_URL)`). Setup: `docker exec curveball-mainnet-postgres-1 createdb -U curveball curveball_test`, then migrate with `SOCIAL_DIRECT_DATABASE_URL=postgres://<user>:<password>@127.0.0.1:5432/curveball_test bun services/backend/src/entrypoints/migrate.mjs` (take credentials from `.env`; never print them). Seed markets, trades, transfers for two wallets; run `publishLeaderboards`; assert summed per-market P&L equals wallet P&L and a rerun at the same `asOfBlock` produces identical rows. **Never point this at the `curveball` database.**

### Task 8: Publish-time recompute and scheduler

**Files:** `services/backend/src/indexing/indexer.mjs`, new pure `services/backend/src/analytics/publishSchedule.mjs` and test.

**Behavior:**
- Remove the `publishLeaderboards` calls inside the transactions (~L1018 and ~L1262); keep the `refreshPerformanceSnapshot` loops.
- `indexTradeRange` / `indexLedgerRange` return whether they wrote rows; the tick sets `dirty = true` if so.
- After `scanStream("venue", ...)` in `tick`, if `shouldPublish({ dirty, lastPublishedAt, now })`: `asOfBlock = min(tradesCursor - 1, ledgerCursor - 1, head - 20n)`; call `publishLeaderboards(pool, asOfBlock)`; set `lastPublishedAt = now`, `dirty = false`. Wrap in `traceBackendTask("social.leaderboard.publish", ...)`; route errors through `onError` without blocking indexing. Only the advisory-lock leader publishes.

**Failing tests:** `shouldPublish` gives false for (dirty, 59s since last), true for (dirty, 60s), false for (clean, 299s), true for (clean, 300s), true when never published. `publishAsOfBlock(head = 1000n, cursors = { trades: 995n, ledger: 990n })` returns `980n`.

### Task 9: API status contract; delete the provisional fallback

**Files:** `services/backend/src/api/features/pulse/leaderboards.mjs`, `services/backend/src/analytics/pulseSql.mjs` (delete `provisionalLeaderboardSql`), new pure `services/backend/src/api/features/pulse/leaderboardResponse.mjs`, test `tests/api/features/pulse/leaderboardResponse.test.mjs`.

**Behavior:**
- `publishedBoard` query adds `AND methodology_version=$3` (current constant). Delete `provisionalBoard` and the `!items.length` fallback.
- `shapeLeaderboardResponse({ category, snapshot, rows, graph, limit, now })` returns `{ category, status: "ranked"|"no_qualifiers"|"pending", methodologyVersion, asOfBlock, asOfTime, publishedAt, stale, paused, ageMinutes, rules, items, watching, progress, label }`.
- `pending` = no v3 snapshot yet: `items: []` plus `rules`.
- Freshness: `stale` when older than 15 min, `paused` when older than 60.
- Ranked items keep current fields (`address, rank, publishedMetrics, followers, isFollowed, stats`) plus `confidence`; compute `realizedReturnPct` with BigInt bps, not `Number(wei)`.
- Blocked wallets filtered from `items` and `watching`. `followers` gets `label: "Most followed"`.
- Route stays `/v1/leaderboards/:category`.

**Failing tests:**
- `no snapshot of the current version returns pending, never a provisional ranking`.
- `a v2 snapshot is ignored` (assert on SQL params).
- `no_qualifiers returns empty items, watching with rank null and provisional true, rules and progress`.
- `watching rows carry no returnBps or netPnlWei`.
- `stale after 15 min and paused after 60`.
- `blocked wallets are filtered`.
- `pulseSql no longer exports provisionalLeaderboardSql`.

### Task 10: Windowed basis for Trending (spec 5.5)

**Files:** `positionLedger.mjs`, `leaderboardEngine.mjs` and their tests.

**Behavior.** `replayWallet(..., { windowStart: S })`: process events before `S` normally to get the state at `S`; reset realized P&L and capital to zero; re-base each open known-basis position at the `exitValue` of its markable balance against the market state of the last trade before `S`, recorded as an opening synthetic buy for peak capital; replay in-window events. Trending uses `S = asOf - 7d`, ranks by windowed `scoredPnl` shrunk with windowed qualifying `n`, and requires `staleMarkCount == 0`. Emerging needs no re-basing (its first trade is inside its 14-day window).

**Failing tests:**
- `pre-window gains are not credited`: bought at 0.05 WETH, exit value 0.08 at `S`, sold in-window for 0.08; windowed realized P&L 0.
- `in-window loss on a pre-window position counts`: exit value 0.08 at `S`, sold in-window for 0.06; windowed realized P&L -0.02.

### Task 11: Frontend types and API client

**Files:** `src/social/types.ts` (~L86-126), `src/social/api.ts` (~L165-167).

`LeaderboardSnapshot` gains `status`, `rules: LeaderboardRules`, `watching: WatchingTrader[]` (rows with `rank: null`, `provisional: true`, no P&L fields), `progress`, `stale`, `paused`, `ageMinutes`, `asOfTime`. `LeaderboardMetrics` gains the Task 5 metrics and drops `sampleLabel` and `methodologyCaveat`. Type-only; verify with `bun run typecheck`.

### Task 12: PulseTraders UI

**Files:** `src/social/PulseTraders.tsx`, `src/social/PulseTraders.test.tsx`, `src/pages/SocialPage.tsx` (only if props change), `src/style.css` (append new classes after the `.pulse-leader` block, ~L8078).

**Behavior:**
- Delete the doc comment (~L39-46) that says methodology is intentionally hidden.
- Branch on `data.status`:
  - `ranked`: `<ol>` rows with rank, `TraderIdentity`, net P&L in WETH as the primary figure (`formatEthAmount` from `src/lib/format.js`), `returnBps` as secondary, and a confidence label.
  - `no_qualifiers`: title "No traders qualify yet"; a requirements checklist generated from `rules` (for example "10 trades of 0.005+ WETH", "3 markets", "5 active days", "0.05 WETH peak capital", "First trade 14+ days ago"), never hard-coded numbers; a "Watching" `<ul>` (not `<ol>`) where each row has a visible "Not ranked" badge, identity, "6 trades, 2 markets", "Meets 2 of 5"; no percentages and no P&L.
  - `pending`: "Rankings are being calculated."
- `paused` shows "Rankings paused" instead of rows; `stale` shows "Updated N min ago".
- Collapsible "How ranking works" (`<details>`) with the five spec 9 lines: profit not percent; open positions valued at what selling would actually return; your own token excluded; minimum sample sizes; updated every few minutes at block N. Do not mention linked wallets (clustering deferred).
- Icons inline SVG following `src/components/ArrowIcon.tsx`; no emoji, no Unicode arrows (`src/noEmoji.test.js` enforces it).

**Failing tests** (`renderToStaticMarkup`, same harness as the existing test):
- `ranked board shows ranks and WETH profit`.
- `no_qualifiers renders the checklist from rules`: pass `rules` with 7 trades and assert "7 trades" appears.
- `watching rows show Not ranked and no percent`: the Watching section HTML contains no `%`.
- `watching renders no rank numbers`: no `aria-label="Rank`.
- `paused board hides rows`.
- `stale board shows Updated N min ago`.
- `How ranking works panel is present`.
Keep the existing `.rise` identity test with its fixture updated to `status: "ranked"`.

### Task 13: Docs changelog

Add `docs/leaderboard-methodology-changelog.md` with a v3 entry: what changed from v2, the section 12 decisions, clustering deferred, old snapshots retained. Commit the spec and this plan alongside it.

## Verification

From the worktree:
1. `bun run --cwd services/backend test` (all backend tests including the new pure suites).
2. `make test` (typecheck, every Bun test including `src/noEmoji.test.js`, non-fork Foundry tests).
3. `bun run typecheck` and `bun run build`.
4. `git diff --check main...HEAD`.
5. Optional DB invariant: `CURVEBALL_TEST_DATABASE_URL=postgres://<user>:<password>@127.0.0.1:5432/curveball_test bun test services/backend/tests/analytics/leaderboardDb.test.mjs`.
6. `make docker-mainnet-rebuild` (root `.env` targets 4153; applies the migration to the LOCAL database). Note: this replaces the shared local `curveball-mainnet` api container with this branch's build. Then `curl -s http://127.0.0.1:8787/health` and `make docker-mainnet-logs | grep social.leaderboard.publish`.
7. Manual check:
   - `curl -s http://127.0.0.1:8787/v1/leaderboards/consistent | jq '{status,methodologyVersion,asOfBlock,stale,rules,watching,progress}'`: expect `status: "no_qualifiers"`, `methodologyVersion: "curve-exit-realized-v3"` (spec section 2: empty by design today), and no P&L or percent keys in `watching`. Repeat for `new`, `trending`, `followers`.
   - Pick two `watching` wallets (the most active, and the one touching 2 markets). Pull their rows read-only:
     ```
     docker exec curveball-mainnet-postgres-1 psql -U curveball -d curveball -c "SET search_path=curveball; SELECT token_address,is_buy,token_amount,net_trader_quote,block_number FROM trades WHERE trader_address='<addr>' AND orphaned=false AND block_number<=<asOfBlock> ORDER BY block_number,transaction_index,log_index;"
     ```
     and the same for `asset_transfers`. Hand-recompute realized P&L (average cost, removed cost rounded up), peak capital, qualifying-trade count, and exit value with `bun -e` using the Task 1 formula plus `market_stats` and `markets.initial_virtual_quote`. Compare against `bun services/backend/src/entrypoints/leaderboardReport.mjs <asOfBlock> <addr1> <addr2>` and the `watching` counts. Values must match to the wei.
   - Confirm the creator/treasury wallet (spec section 2) is absent.
   - Open `http://127.0.0.1:5173`, Pulse, Leaderboard: confirm the checklist, Watching rows with "Not ranked" and no %, and the "How ranking works" panel.

## Delivery

- Branch `feat/leaderboard-v3-methodology` in the worktree, one commit per task (1-13) with the attribution trailer. Never commit `.env`.
- **Do not push to `main`, do not deploy to the VPS, do not run migrations against production.** `.codex/DEPLOYMENT.md` says migrations need their own runbook. Stop after local verification and report: branch, commit list, test output, curl output, the two hand-recomputed wallets, and any gaps.
- **Risks:** bulk-load performance (full replay per publish; log `durationMs`, revisit above ~10k wallets); transfer classification (curve legs vs outbound); graduated markets unmarked until venue indexing exists; snapshot volume (up to 1,152/day before pruning); an empty board on day one (intended).
- **Rollback:** the migration is additive with defaults, so old code runs unchanged against the new schema; no down-migration. Reverting code restores v2; the old `publishedBoard` picks the newest snapshot regardless of version, so it would find a v3 snapshot and fall back to provisional until v2 republishes (acceptable, or delete v3 snapshots locally). v2 snapshots are never deleted.

## Spec ambiguities and resolutions

1. **Exit formula (4.2):** the spec's single combined floor differs from the contract by up to 2 wei. Port `CurveMath.quoteSell` exactly (fee and tax floored separately).
2. **Gross above real reserves:** the contract reverts. Clamp to `realQuote`, then apply fees; if `feeBps > 0` and the fee floors to 0, exit value is 0.
3. **Depth gate "vQ >= 0.5 WETH" (5.2):** `vQ` includes the 1 WETH virtual reserve, so it always passes. Use real quote: `vQ - initial_virtual_quote >= 0.5 WETH`.
4. **"Mark at 0 value, not -100%":** stale or unpriceable positions contribute 0 unrealized; cost stays in peak capital; `staleMarkCount++`.
5. **TWAP "of market price":** time-weighted average of `vQ` with `vT = ceil(k/vQavg)`, giving a full curve state for an exact exit quote; slightly more conservative than averaging price.
6. **Positive P&L requirement:** the spec states it only for Trending. Require `scoredPnl > 0` for every ranked P&L category (matches v2), so wash and loss wallets never rank.
7. **50% open cap:** `scoredUnrealized = min(unrealized, max(realized, 0))` when positive; negative unrealized always counts in full.
8. **Where Watching rows live:** a separate `watching` array with `items: []`, so legacy renderers cannot show ranks; stored in `leaderboard_snapshots.details`, not `leaderboard_rows`.
9. **Where creator exclusion and the ceil fix go:** the spec says `rebuildCurvePosition`; implement both in the v3 engine only. `curve_positions` feeds the profile page, which keeps a full-wallet view; changing it would force a position rebuild. Revisit in a later profile change.
10. **Emerging windowed basis:** moot; an Emerging wallet's first trade is inside its 14-day window. Apply 5.5 only to Trending.
11. **Graduated and pool markets (T12):** with `venue_swaps` empty, `ready` and `graduated` positions get no exit mark (flagged). Transfers to pools are outbound at zero proceeds. Revisit when venue indexing lands.
12. **"1% of median-or-peak capital" qualifier:** use peak capital.
13. **20-block publish depth:** `asOfBlock = min(stream cursors - 1, head - 20)`; later events are ignored so snapshots are reproducible.
14. **Which rules are public:** checklist and scoring numbers only; depth-gate and launch-window internals stay server-side (spec 9).
15. **Status before the first v3 publish:** `"pending"`, never a provisional ranking.
16. **Snapshot retention:** prune v3 snapshots older than 7 days except the latest per category; never prune other versions.
