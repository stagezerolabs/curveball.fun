# Curveball indexer (reorg path) — security review

**Target:** `services/social/src/indexer.mjs` (953 LOC), `performance.mjs`, `packages/db/src/schema.ts`
**Method:** line-by-line trace of all four scan streams, then replay of the indexer's **verbatim SQL** against a real
PostgreSQL 15 instance migrated with `packages/db/drizzle/0000..0006`, plus a real forked chain on anvil.
**Baseline:** no live RISE RPC was used; every finding is either reproduced in Postgres or is a structural property
of the statements themselves.

Nine findings. Two [Medium] are in the reorg window and the market/trade orphan asymmetry; the rest are
projection-bookkeeping gaps. **I could not find a divergence in the derived analytics tables themselves** —
they rebuild from `orphaned=false` rows on the trade and venue paths, and that design is sound.

Harness: `.review-baseline/indexer/reorg-harness.mjs` (schema-accurate reorg replay)
`.review-baseline/indexer/crosscheck.mjs` (I7, I8, I9)
`.review-baseline/indexer/logicalid-check.mjs` (collision analysis)
`.review-baseline/indexer/outbox-check.mjs` (SSE tape persistence)
`.review-baseline/indexer/reorg-window.mjs` (window arithmetic)
`.review-baseline/indexer/anvil-reorg.mjs` (real fork)**

| #   | Sev     | Finding                                                                           |
| --- | ------- | --------------------------------------------------------------------------------- |
| I1  | Med     | Deep reorg (>16 blocks) unrecoverable; rows marked `finalized` at 2 confirmations |
| I2  | Med     | `chain_logs` un-orphans independently of derived rows; no continuity check        |
| I3  | Low–Med | `assets` has no `orphaned` column; reverted launch metadata is permanent          |
| I4  | Low     | `notification_outbox` never retracted; outbox grows unbounded                     |
| I5  | Low     | `reserve_rounds` has an `orphaned` column, is in neither list, unused             |
| I6  | Info    | Snapshot tables accumulate indefinitely (4 rows per scan tick)                    |
| I7  | Med     | Reorged-away market still contributes to wallet stats and leaderboards            |
| I8  | Low     | Ledger stream rebuilds no derived state; stale balances served silently           |
| I9  | Low     | Log-index shift raises `23505` and aborts the whole range transaction             |

---

## Architecture as built (verified, not assumed)

Four independent streams, each with its own cursor in `chain_cursors`, each in one transaction:

| stream    | scans                       | owns topics                                 | orphans                                                                                   |
| --------- | --------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `factory` | launchpad                   | launch, ready, abort, graduated             | `chain_logs`, `markets`                                                                   |
| `trades`  | launchpad                   | Trade                                       | `chain_logs`, `trades`                                                                    |
| `ledger`  | launchpad + token contracts | Transfer, Fee\*, Buyback, LpFees, Reserve\* | `chain_logs`, `asset_transfers`, `protocol_flows`, `buyback_executions`, `reserve_claims` |
| `venue`   | graduated pools             | Swap                                        | `chain_logs`, `venue_swaps`                                                               |

Each stream orphans only its own topics from `chain_logs` (`lifecycleTopics` vs `tradeTopic` at
`indexer.mjs:40-44`). That separation is correct and deliberate — the comment at `:39` says so, and it holds.

**The parts that are genuinely good, and worth not regressing:**

- Every range is wrapped in `transaction(async (db) => …)`. A partial range cannot commit.
- `market_stats`, `market_candles` and `curve_positions` are **rebuilt** from `WHERE orphaned=false` rows after each
  orphan pass (`:580-593`, `:875-878`). They are derived, so they self-heal rather than accumulate damage.
  `rebuildCurvePosition` recomputes from the trade log rather than patching deltas, and deletes the row when the
  trade set becomes empty (`:109-112`). This is the correct shape.
- `rebuildMarketStats` deletes the stats row when the last trade is orphaned (`:211-214`) — no zero-valued ghost.
- Lifecycle state is re-read from the chain at `toBlock` for **every touched market** (`:452-464`), including
  markets that were just orphaned. This is what makes the state machine (trading/ready/aborted/graduated) converge
  instead of going stale — a subtle and correct decision.
- Single-writer leadership via `pg_try_advisory_lock(chainId, 112927085)` on a dedicated connection (`:902-917`),
  with `initialized` reset if that connection errors. Re-entrant, and handled correctly.
- `markets` is re-read from the contract at the log's own block for `initialVirtualQuote` (`:384`), avoiding the
  "current state applied to historical event" mistake.

I could not find a divergence in the derived analytics tables. **The findings below are in the
projection/orphaning bookkeeping around them.**

---

## Findings

### I1. [Medium] A reorg deeper than `REORG_OVERLAP` is unrecoverable, while rows are marked `finalized` at 2 confirmations

`indexer.mjs:46`, `:928`, `config.mjs:68`, `services/social/.env.example`

```
REORG_OVERLAP        = 16        // indexer.mjs:46
SOCIAL_CONFIRMATIONS = 2         // config.mjs:68 default; .env.example ships 2
safeHead = head - confirmations  // indexer.mjs:928
fromBlock = stored - REORG_OVERLAP   // indexer.mjs:887
```

The scanner rewinds **16** blocks from the cursor. So the deepest fork it can ever revisit is block
`stored - 16`. Everything below that was already written as `finalized=true`
(`recordBlock`/`recordOccurrence` set it unconditionally) and is never read again.

Reproduced (`reorg-window.mjs`):

```
head   = 1000000
safeHead = 999998   (head - 2)
rewindTo = 999984   (stored - 16)
Deepest revisitable fork point = 999984
Blocks 999983 and below are permanent.
```

Two problems compound here:

1. **The constants are unreconciled.** `finalized=true` is asserted at depth 2, but recovery is only possible to
   depth 16. Nothing enforces `CONFIRMATIONS <= REORG_OVERLAP`, and the shipped example sets 2. A reader of the
   schema would reasonably take `finalized` to mean "cannot change" — it means "we have not looked again".
2. **`REORG_OVERLAP` is a fixed 16 regardless of how far back any write reaches.** `publishLeaderboards` and
   `refreshPerformanceSnapshot` write snapshots stamped with `as_of_block = toBlock`. `chain_logs` retention is
   unbounded. A single constant is carrying three different windows.

Impact: a fork deeper than 16 blocks leaves the off-chain ledger permanently divergent from chain, with rows
asserting finality. On an OP-Stack chain this is unlikely — which is exactly why it is worth an assertion rather
than a comment.

Fix: derive the rewind from the deepest thing a range can write, or assert `confirmations <= REORG_OVERLAP` at
startup and refuse to run otherwise. The cheapest correct change is the assertion.

### I2. [Medium] `chain_logs` can be un-orphaned independently of the rows derived from it

`indexer.mjs:88-98` vs `:360-367`, `:497-500`

```js
// recordOccurrence — keyed on block_hash
INSERT INTO chain_logs (... orphaned, finalized) VALUES (..., false, true)
ON CONFLICT (chain_id, block_hash, log_index)
DO UPDATE SET orphaned=false, finalized=true, ...     // <- always un-orphans
```

Because the scan deliberately overlaps 16 blocks, `recordOccurrence` runs again over already-seen blocks. It
un-orphans the log row on **every** replay. The derived rows are lifted only by a matching re-insert (with
`orphaned = false` hardcoded in the VALUES, `:394`, `:521`, `:698`).

There is nothing tying the two together. Reproduced against real Postgres (`reorg-harness.mjs`):

```
=== H1: after orphaning, before re-scan ===
market.orphaned = true
log.orphaned    = [ true ]
=== after re-scanning the SAME old-chain log ===
chain_logs orphaned flags: [false]
H1 CONFIRMED: recordOccurrence flipped an orphaned chain_logs row back to orphaned=false
```

**A real reorg confirms the fork is observable and that nothing looks for it.** Driven against anvil with a
compiled emitter contract (`anvil-reorg.mjs`):

```
--- BEFORE reorg ---
block 2 hash 0xd7a535cbd705bdb28a666cc0dcbedc7fa0a5a4b1cbb20575aa792fa29d1fbb0d
logs at that block: 1
--- AFTER the fork (block 2 replaced) ---
block 2 hash: 0xace46769b459c5658b30d45bf46877745ffea84f2e1620dd89eb0f3a5f47815f
hash changed?     : true
logs at that block: 0
emitting tx gone? : true
```

So the scanner _can_ see the divergence — the same height now has a different hash — but it never asks the
question. `chain_blocks` is written and never read back during scanning; `parent_hash` (`:85`) and `canonical`
(`:78`) have no reader at all. The indexer therefore handles reorgs by "orphan this range, then re-insert
whatever the RPC returns", which converges _per stream, per topic_ — not because a fork was detected.

**Reachability, stated honestly.** In the normal case the RPC returns the canonical branch, new hashes are seen,
new rows are inserted, and the old rows stay orphaned — correct. The un-orphan path needs the scan to re-read a
_superseded_ branch. That happens when the RPC answers inconsistently across calls — a load-balanced or
read-replica endpoint (common with hosted providers) serving a stale view for part of the rewind range, or a
request retried against a lagging backend. `indexer.mjs:47` builds the client with
`http(config.rpcUrl, { retryCount: 5, retryDelay: 500 })`, so retries against a multi-backend endpoint are
explicitly in play.

Fix: teach the scanner to detect that a previously-seen height now has a different hash and orphan the whole
subtree at that point — one rewind-and-replay — rather than relying on topic-scoped orphaning per stream. Reading
`parent_hash` back is what makes that possible, and it is already stored.

### I3. [Low–Medium] `assets` has no `orphaned` column, so a reverted launch's token metadata is permanent

`packages/db/src/schema.ts:112-126`, `indexer.mjs:411-414`, `metadata.mjs:50`

Verified against the migrated database:

```
=== which tables have an `orphaned` column? ===
asset_transfers, buyback_executions, chain_logs, markets, protocol_flows,
reserve_claims, reserve_rounds, trades, venue_swaps
```

`assets` is absent — it was left out of `DERIVED_TABLES_TO_ORPHAN` (`:272`) and `DERIVED_TABLES_TO_CLEAR`
(`:273`), and it has no column to hold the flag. Reproduced (`reorg-harness.mjs`):

```
=== after the reorg was detected and the range orphaned ===
market.orphaned = true (correctly true)
asset row still: {"name":"OldName","symbol":"OLD","metadata_uri":"ipfs://old"}
=== after re-scanning the replaced range (chain B, no launch here) ===
market: {... "orphaned":true}
asset : {"name":"OldName","symbol":"OLD","metadata_uri":"ipfs://old"}
--- H2 RESULT ---
H2 CONFIRMED: assets row from the reverted launch survives the reorg
```

The market row correctly carries the token name/symbol/uri, and it correctly orphans. The `assets` row does not.
`metadata.mjs:50-53` then re-fetches that dead token's IPFS URI **every 24 hours, forever** — an egress loop for a
token that never existed.

Blast radius is contained, and I want to be precise rather than inflate it: `assets` is read in exactly two
places, both `LEFT JOIN assets` inside `marketSelect` (`server.mjs:553`, `:575`), and both are gated on
`m.orphaned = false`. So a stale asset row is not independently served. It becomes user-visible when a `markets`
row is un-orphaned (the I2 path), at which point `token_metadata` supplies the reverted launch's name and artwork.

Severity is Low–Medium: the projection cannot be corrected, and it is a latent input to I2.

Fix: add `orphaned` to `assets`, include it in the factory orphan pass, and filter it in `metadata.mjs`.

### I4. [Low] `notification_outbox` is an append-only tape that is never retracted

`indexer.mjs:416`, `:447`, `:574`, `:869` — all `ON CONFLICT (event_key) DO NOTHING`; no `DELETE` or `UPDATE`
anywhere. Verified: `grep` for any deletion of `notification_outbox` across `services/social/src/` returns nothing.

The trade range _does_ clean up the adjacent table — `DELETE FROM notifications WHERE logical_event_id=ANY(...)`
(`:492-495`) — but `notification_outbox` is the SSE feed's source, and it is untouched. Reproduced
(`outbox-check.mjs`): after a trade is orphaned, the outbox row remains and the SSE pump's own query
(`server.mjs:137`, `WHERE id>$1 AND available_at<=now()`) still returns it.

Accurate impact: a client that is **already streaming**, or one that resumes with `Last-Event-ID`, receives an
event for a trade the indexer has since orphaned. A client connecting fresh starts at `MAX(id)` (`server.mjs:126`)
and does not replay. So this is a live-vs-reload inconsistency, not a persistent lie.

Secondary: the table grows without bound. There is no retention or pruning, and the SSE pump scans it by `id`
every 2 seconds.

Fix: delete or tombstone the outbox rows in the same orphan pass that removes the corresponding `notifications`.

### I5. [Low] `reserve_rounds` carries an `orphaned` column and is in neither orphan list

`packages/db/src/schema.ts:291`, migrated table `curveball.reserve_rounds`

It has `orphaned`, but `grep -rn "reserve_rounds" services/social/src/ packages/db/src/` returns only the schema
definition — the table is never written and never read. The comment at `:753` explains why: _"The lean reserve has
no rounds: each curve buyer claims once, so round_id is always 0."_ It is a V1 leftover.

Not a vulnerability. Worth deleting, because a table with an orphan flag that nobody maintains reads like an
orphan path that exists.

### I6. [Informational] Snapshot tables accumulate indefinitely

`performance.mjs:26-75` (snapshot), `:112-224` (leaderboards)

`trader_performance_snapshots` and `leaderboard_snapshots` are never pruned — they are in neither derived-table
list. Each `publishLeaderboards(db, toBlock)` writes four rows (one per category) per leaderboard refresh, and
leaderboards publish on **every** trade range and **every** ledger range that touches a wallet (`:598`, `:768`).
That is a write amplification of four snapshot rows per scan tick, retained forever.

The read path is correct — `server.mjs:424` takes the newest `published_at IS NOT NULL ORDER BY as_of_block DESC`,
and the snapshots are upserted on `(chain, category, period, as_of_block, methodology)`, so a re-scanned height
updates in place rather than duplicating. This is a growth question, not a correctness one.

---

### I7. [Medium] A reorged-away market keeps contributing to wallet analytics

`indexer.mjs:356-363` (orphan pass) vs `:378-419` (launch loop) vs `server.mjs:208-234` (`statsSql`), `:218`

The factory range orphans `markets` by launch block (`:360-363`), then the launch loop re-inserts
only the launches the RPC actually returns. If the launch is not re-found, nothing un-orphans the
market — correctly. But `indexTradeRange` never touches `markets.orphaned` (verified: no write to
that column outside the factory range), and it orphans trades on its own topic independently.

So a market can be orphaned while its trades stay live. Reproduced (`crosscheck.mjs`):

```
markets.orphaned            = true   (market hidden)
trades rows by orphaned flag = [{"orphaned":false,"n":1}]

API view:
  markets in listings (orphaned=false): 0
  trades still counted in wallet stats : 1
  => a trade contributes to a wallet's volume for a market that no longer exists.
```

`server.mjs` filters markets on `m.orphaned=false` but wallet stats filter trades on `t.orphaned`
only (`statsSql` at `:208-234`, filter at `:218`). The result is a wallet whose trade count, volume and realized PnL
include a market that the UI does not show. It is not merely cosmetic: `performance.mjs` feeds the
leaderboards from the same trade rows, so leaderboard ranks inherit the phantom volume.

Fix: when a market is orphaned, orphan its trades/venue_swaps in the same pass — or filter the
stats/leaderboard queries by market existence. The former is cheaper and matches the existing
orphan shape.

### I8. [Low] The ledger stream rebuilds no derived state, so transfer-derived balances go stale silently

`indexer.mjs:634-773`

`indexLedgerRange` reconstructs `asset_transfers`, `protocol_flows`, `buyback_executions` and
`reserve_claims`, and calls `refreshPerformanceSnapshot`/`publishLeaderboards` (`:767-768`) — but it
never calls `rebuildCurvePosition`, `rebuildMarketStats` or `rebuildMarketCandles`. Verified by
grep: those three functions are invoked only at `:584-585` (trades) and `:591-592`, `:876-877`
(venue). Nothing in the ledger range.

Reproduced (`crosscheck.mjs`):

```
live asset_transfers after orphaning: 0
curve_positions.known_basis_token_balance still: 10 (stale)
transfer-derived balance: MISSING -> COALESCEs to curve_positions: 10
=> the endpoint returns a stale-but-plausible number rather than erroring.
```

The profile position query (`server.mjs:380-397`) computes a transfer-derived balance and
`COALESCE`s it over `curve_positions.known_basis_token_balance`. When the transfer rows are
orphaned, the derived term disappears and the stale `curve_positions` value silently takes over.
`marketHolders` (`server.mjs:654`) does the same over `asset_transfers` and returns 0 rows.

The divergence self-heals on the next trade in that token — and **never** if there is none. So this
is a "wrong number, no error, possibly permanent" case, which is the worst kind for a PnL display.

### I9. [Low] A reorg that shifts a transaction's log positions aborts the whole range with a unique-index violation

`packages/db/src/schema.ts:191`, `indexer.mjs:519-522`

`trades` has both a PK on `logical_id` (`chain:txHash:logIndex:address:topic0`) and
`uniqueIndex("trades_chain_log_uidx").on(chainId, transactionHash, logIndex)`. The inserts specify
`ON CONFLICT (logical_id)` — which does **not** arbitrate the second constraint. Reproduced
(`crosscheck.mjs`):

```
=== (A) unique-index conflict on trades_chain_log_uidx ===
branch A inserted: 1 row
branch B insert: FAILED -> 23505 trades_chain_log_uidx
```

If a re-included transaction's logs land on different indexes than before, a log can occupy an
index another log already used under the same tx hash. The insert then raises `23505`, and because
every range is one transaction, **the entire range rolls back** — so the stream makes no progress
and retries the same range on the next tick.

Reachability is narrow and I want to be honest about that: a transaction's logs are ordered
deterministically, so this needs the tx to move within its block such that its log indexes shift
onto values already recorded for the same tx hash. That is unusual but not impossible during a
deep reorg with differing transaction ordering. Recording it as a robustness gap rather than an
exploitable bug — the cost if it fires is a stuck stream, not corrupted data.

Fix: add `transaction_hash, log_index` to the conflict target, or drop the redundant unique index
in favour of the primary key, which already identifies the log.

---

## Corrections to my own earlier reasoning

Worth recording, because they are the kind of thing an auditor should show their work on:

- **`logicalId` collisions are NOT reachable through the obvious path.** I initially suspected that
  two branches of a reorg could collapse onto one `logical_id` and silently merge distinct events.
  Tested (`logicalid-check.mjs`): they cannot. `transactions` groups by hash, so two events from the
  same transaction can never share a `logIndex`; and a real collision needs the _same_ `(tx,
logIndex)` to be a _different_ event, which is I9 above — a stuck stream, not a merged row.
- **The derived tables genuinely do self-heal on the trade and venue paths.** I expected to find
  stale aggregates surviving a reorg. I could not construct one: every orphan pass that touches
  `trades` or `venue_swaps` is followed, inside the same transaction, by a rebuild of the affected
  positions, stats and candles. I8 is the exception — the ledger path — not the rule.

- **No divergence in `market_stats` / `market_candles` / `curve_positions`.** Every path that orphans trades or
  swaps rebuilds the affected token's stats and candles inside the same transaction (`:590-593`, `:875-878`), and
  every affected trader's position is rebuilt (`:583-585`). I traced the ordering and could not construct a
  sequence where an orphaned trade survives in an aggregate.
- **No topic cross-contamination between streams.** `lifecycleTopics` and `tradeTopic` are disjoint and each
  stream orphans only its own (`:357`, `:483`).
- **No lost-write on a replayed range.** Every derived insert is an UPSERT keyed on a stable `logicalId`
  (`chain:txHash:logIndex:address:topic0`), and every trade-derived row is recomputed rather than patched.
- **No cursor regression race.** Each stream owns its own cursor row and the advisory lock serialises writers.

## Provenance of this review

Substantive findings were first established while the repo was at commit `406298b`. During the review the
working tree advanced: **HEAD is now `f065e0e`** (merged ~75 minutes in), and a concurrent session has
uncommitted edits in `services/social/src/server.mjs` and `performance.mjs`.

**Line references below were re-verified against the current working tree, and the findings were re-checked
against the changed files.** Concretely:

- `indexer.mjs`, `packages/db/src/schema.ts`, `metadata.mjs`, `privyAuth.mjs`, `keeper/graduation-keeper.mjs`,
  and `contracts/` are **untouched** in the working tree — findings I1–I6, I9 and all contract/keeper findings
  are unaffected.
- `server.mjs` and `performance.mjs` **are** modified. I7 (wallet stats counting an orphaned market) and I8
  (stale balances under `COALESCE`) were re-verified against the new code and still hold; the line numbers in
  those sections were corrected. `statsSql` moved to `:208-234`, the profile position query to `:380-397`, the
  asset joins to `:553`/`:575`, `marketHolders` to `:654`.

If you are reading this after further edits, re-run `.review-baseline/indexer/crosscheck.mjs` — it is
self-contained and asserts each claim independently of line numbers.

## Limitations

- I did not drive `startIndexer` end-to-end against a node. I replayed the indexer's exact SQL against a real,
  correctly-migrated Postgres, and separately produced a real reorg on anvil to confirm the fork is observable.
  The DETECTION mechanism is demonstrated and its absence confirmed; I did not observe I2 firing from a live
  stale-RPC response, because inducing inconsistent answers from a load-balanced endpoint is not something a
  local anvil reproduces.
- The reorg on anvil was produced with `anvil_snapshot` + `anvil_revert` + `anvil_mine` rather than
  `anvil_reorg`, whose parameter shape is version-dependent. The observable is identical — same height, new hash,
  log gone — but it is worth stating that it is a snapshot-revert rather than an RPC-level fork.
- `confirmations=2` is the default and the shipped example value. The production `.env` value was not read
  (secrets), so the deployed depth is unverified. If production sets a larger value the I1 window narrows but the
  structural point stands.
- I did not review `worker.mjs`, `milestones.mjs`, or `profiles.mjs`; they are small and out of scope here.
