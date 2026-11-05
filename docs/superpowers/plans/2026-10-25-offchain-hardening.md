# Off-Chain Layer Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the open off-chain security findings — the moderator fail-open Medium, unvalidated request input, missing rate limiting, and the indexer reorg-path Mediums (I1, I2, I7, I9 + lows I3, I4) from the 2026-10-18 Dreadnode review — with tests and migrations.

**Architecture:** Layer practical mitigations onto the existing single-Postgres social service (`services/social/src/*.mjs`): remove the default-admin fallback, extract shared validation, add a DB-backed rate limiter, raise indexer finality depth with deep-reorg recovery, propagate orphans transactionally, and retract reorged-away notifications/assets.

**Tech Stack:** Node 20.19+, Bun test, `pg`, viem, Drizzle migrations in `packages/db`.

**Spec:** Prior reviews `docs/audits/dreadnode-2026-10-18/*.md` (findings I1–I9, M1), `x-ray/x-ray.md` §8, `services/social/src/config.mjs`, `services/social/src/indexer.mjs`.

## Global Constraints

- Do not change chain-trust semantics: on-chain events are truth; PostgreSQL stores projections; the indexer is advisory-locked and idempotent.
- All ORMs/raw SQL follow the existing patterns in `indexer.mjs`/`packages/db` (query builders, `ON CONFLICT` upserts, `orphaned` flags).
- New env vars go into `services/social/.env.example` and are validated in `config.mjs` with the existing `positiveInteger`/`required` pattern.
- Tests run with `bun test`; DB-dependent code must be unit-tested with a mocked `pg` pool or the existing fixture style — no live-DB tests in CI.
- Every migration goes through `packages/db/drizzle` (existing migration tooling).
- Keeper-related hardening (balance alert) lives in the operator-economy plan — do not duplicate here.

## Review Focus

- **Mainnet boots with the default admin** — after this plan, an unset `SOCIAL_ADMIN_ADDRESS` must be a hard error (no fallback), on every chain.
- **Malformed input still reaches SQL casts** — the flagged routes (cursors, `=ANY($n::bigint[])` casts, ids) must return 400 before hitting the DB.
- **Rate limiter makes write paths fail closed under Postgres hiccups** — the limiter must fail *open* on DB errors (log + allow) but the per-key budget itself must never be bypassable by an attacker; add a test for both directions.
- **Reorg deeper than `REORG_OVERLAP` leaves stale truth** — recovery must re-fetch canonical logs for the range and reconcile, not just orphan.
- **A reorged-away market still ranks traders** — analytics/leaderboard queries must filter `orphaned=false` end-to-end, and notifications from orphaned rows must be retracted.

---

### Task 1: Remove the moderator default fallback

**Files:**
- Modify: `services/social/src/config.mjs`
- Modify: `services/social/.env.example`
- Create: `services/social/src/config.test.mjs`
- Test: `bun test src/config.test.mjs`

**Interfaces:**
- Produces: `export function loadConfig(env: Record<string, string | undefined>): Config` — pure; `main config = loadConfig(process.env)` at import. `admin` requires `SOCIAL_ADMIN_ADDRESS`; missing or non-address → `throw new Error("SOCIAL_ADMIN_ADDRESS is required.")`; `0x5cc42e772f67089b4670eec4dcd904be2f2d511c` is explicitly rejected with `"SOCIAL_ADMIN_ADDRESS must not use the removed default address."` when the value equals it.

- [ ] **Step 1: Write the failing test** — `loadConfig({...minimalEnv, SOCIAL_ADMIN_ADDRESS: undefined})` throws; `loadConfig({...minimalEnv, SOCIAL_ADMIN_ADDRESS: "0x5cc42e772f67089b4670eec4dcd904be2f2d511c"})` throws; valid env returns `config.adminAddress === addr.toLowerCase()`.

- [ ] **Step 2: Run the test to verify it fails** — `bun test src/config.test.mjs` → FAIL

- [ ] **Step 3: Refactor `config.mjs`** — split the current module-level side effects into `loadConfig(env)` returning frozen config; replace the fallback line with the error; keep `getAddress` checks; update `.env.example` (`SOCIAL_ADMIN_ADDRESS=` now required, comment removed).

- [ ] **Step 4: Run the test to verify it passes** — `bun test src/config.test.mjs` → PASS; full `bun test` in `services/social` still green (fixtures that set `SOCIAL_ADMIN_ADDRESS` already do so).

- [ ] **Step 5: Commit**

```bash
git add services/social/src/config.mjs services/social/src/config.test.mjs services/social/.env.example
git commit -m "fix(social): require SOCIAL_ADMIN_ADDRESS, remove default fallback"
```

### Task 2: Shared request validation (400s, not 500s)

**Files:**
- Create: `services/social/src/validation.mjs`
- Modify: `services/social/src/server.mjs` (routes flagged by prior review: cursor decoding at `:55-64`-equivalent, notifications `=ANY($3::bigint[])`, markets template; keep the same behavior for valid inputs)
- Create: `services/social/src/validation.test.mjs`
- Test: `bun test src/validation.test.mjs` + `bun test src/server.mjs`-equivalent smoke if a server test exists

**Interfaces:**
- Produces: `export function decodeCursor(value: string | null): unknown` (throws `HttpError(400, "The pagination cursor is invalid.")` on malformed base64url/non-object JSON), `export function parseId(value: unknown): number` (positive safe integer or 400), `export function parseBigIntArray(value: unknown): bigint[]` (array of digit strings / integers, else 400), `export function boundedLimit(url, fallback?, maximum?)` (move from `server.mjs`).
- Consumes: nothing; pure module.

- [ ] **Step 1: Write the failing test** — `decodeCursor("@@bad@@")` throws with status 400; `parseId("abc")` 400; `parseId("0")` 400; `parseBigIntArray(["1","2"])` returns `[1n,2n]`; `parseBigIntArray(["1","x"])` 400; `boundedLimit(url("?limit=99999"))` returns maximum.

- [ ] **Step 2: Run the test to verify it fails** — `bun test src/validation.test.mjs` → FAIL

- [ ] **Step 3: Implement `validation.mjs` + rewire** — move/augment the existing helpers out of `server.mjs`; replace the flagged callsites with the new functions; keep outer try/catch that maps `HttpError` → 400 (existing pattern).

- [ ] **Step 4: Run the test to verify it passes** — `bun test src/validation.test.mjs` → PASS; `bun test` full suite green.

- [ ] **Step 5: Commit**

```bash
git add services/social/src/validation.mjs services/social/src/validation.test.mjs services/social/src/server.mjs
git commit -m "feat(social): shared input validation, 400 before SQL casts"
```

### Task 3: DB-backed rate limiting + artwork burst guard

**Files:**
- Create: `services/social/src/rateLimit.mjs`
- Create: `services/social/src/rateLimit.test.mjs`
- Modify: `services/social/src/server.mjs` (apply to authenticated writes and admin routes)
- Modify: `services/social/src/config.mjs` (envs)
- Modify: `services/social/.env.example`
- Modify: `api/artwork.js` (in-process burst limiter)
- Modify: `api/artwork.test.js`
- Test: `bun test src/rateLimit.test.mjs`, `bun test` in `api/` — actually run `bun test api/artwork.test.js` from repo root if that is the current runner (confirm with the existing test file's runner)

**Interfaces:**
- Produces: `export function createRateLimiter(pool): { consume(key: string, opts: { windowMs: number; max: number }): Promise<boolean> }` — fixed window via one upsert row in a new `rate_limits` table: `INSERT ... ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1 WHERE rate_limits.count < $max RETURNING count`; returns true (allowed) when the row returns, false when it doesn't (insert path also uses `WHERE` to bound). DB errors → log + `return true` (fail open), documented.
- Config: `SOCIAL_RATE_LIMIT_WRITES_PER_MIN` (default 30), `SOCIAL_RATE_LIMIT_ADMIN_PER_MIN` (default 5), validated as positive integers.
- Migration: one Drizzle migration creating `rate_limits (key text, window_start bigint, count int, primary key (key, window_start))`.

- [ ] **Step 1: Write schema migration + failing test** — migration file in `packages/db/drizzle`; `rateLimit.test.mjs` uses a fake `pool` returning scripted rows: (a) 30 allows then 1 deny with `max=30`; (b) new window (`window_start` rollover) resets; (c) pool throwing → `consume` resolves true and logs; (d) `key` is namespaced `wallet:<address>` / `ip:<addr>` by caller.

- [ ] **Step 2: Run the test to verify it fails** — `bun test src/rateLimit.test.mjs` → FAIL

- [ ] **Step 3: Implement** — `rateLimit.mjs` with the upsert; wire in `server.mjs` after `requirePrivyWallet` for writes (follows/notes/convictions/reports/notifications-read) keyed by wallet, and before admin routes keyed by admin wallet; apply `api/artwork.js` burst limiter (process-local map keyed by `x-forwarded-for`/IP, 10 req/min/ip) with the existing size/magic checks untouched; document the edge rate limit requirement in `deploy/README.md` (already noted) and the new envs in `.env.example`.

- [ ] **Step 4: Run the tests to verify they pass** — `bun test src/rateLimit.test.mjs` → PASS; `bun test` repo apps green; manual `docker compose` local-stack smoke: two rapid POSTs show header/increment behavior if observable, else verify via logs.

- [ ] **Step 5: Commit**

```bash
git add services/social/src/rateLimit.mjs services/social/src/rateLimit.test.mjs services/social/src/server.mjs services/social/src/config.mjs services/social/.env.example api/artwork.js api/artwork.test.js packages/db/drizzle
git commit -m "feat(social): DB-backed rate limiting and artwork burst guard"
```

### Task 4: Indexer finality depth + deep-reorg recovery (I1)

**Files:**
- Modify: `services/social/src/config.mjs` (new env)
- Modify: `services/social/src/indexer.mjs` (finality column logic, recovery sweep; locate `REORG_OVERLAP` at `:93`, `chains/chain_logs` inserts `:134-153`, orphan sweep `:1144-1149`)
- Modify: `services/social/.env.example`
- Modify: `services/social/src/indexer.test.mjs` (create if none exists; follow existing test style for query builders via mocked pool)
- Test: `bun test src/indexer.test.mjs`

**Interfaces:**
- Config: `SOCIAL_FINALIZED_CONFIRMATIONS` (default `10`), distinct from `SOCIAL_CONFIRMATIONS` (observed, stays `2`). `chains.finality_confirmations` insert at `:480-487` uses the new value.
- Produces: `export function finalizeRangeSql(chainId, fromBlock, toBlock): string` and `export function deepRecoveryScanSql(...): string` — query builders unit-testable without DB. Recovery: when an orphaned `chain_logs` row is found at `block_number <= latest - REORG_OVERLAP` (deeper than overlap), re-fetch canonical logs for its range via the existing log-fetch path and `ON CONFLICT ... DO UPDATE orphaned=false, canonical=true` (same shape as `:149-153`), then re-run the projector for that range (reuse the existing rebuild). Add `indexer-runner`-level gating so recovery runs at most once per sweep.

- [ ] **Step 1: Write the failing test** — `finalizeRangeSql` marks rows `finalized=true` only when `block_number` is more than `SOCIAL_FINALIZED_CONFIRMATIONS` behind latest; deep recovery re-canonicalizes a row that was orphaned beyond `REORG_OVERLAP` (simulate by asserting the `ON CONFLICT` query shape and run order: orphan → re-fetch → `DO UPDATE orphaned=false`); no query builder references a stale `finality` constant.

- [ ] **Step 2: Run the test to verify it fails** — `bun test src/indexer.test.mjs` → FAIL

- [ ] **Step 3: Implement** — split the finality constant out of the current insert; wire the recovery sweep into `orphanSweep`; keep the advisory lock behavior; update `.env.example`.

- [ ] **Step 4: Run the test to verify it passes** — `bun test src/indexer.test.mjs` → PASS; full `bun test` in `services/social` green.

- [ ] **Step 5: Commit**

```bash
git add services/social/src/config.mjs services/social/src/indexer.mjs services/social/src/indexer.test.mjs services/social/.env.example
git commit -m "fix(indexer): finality at 10 confirmations with deep-reorg recovery (I1)"
```

### Task 5: Transactional orphan propagation + analytics exclusion (I2, I7)

**Files:**
- Modify: `services/social/src/indexer.mjs` (orphan sweep around `:1144-1149`, `markets`/`trades`/`venue_swaps`/`asset_transfers` orphan updates `:430`, `:852`, `:1149`)
- Modify: `services/social/src/performance.mjs` / `pulseSql.mjs` / `server.mjs` analytics queries (add `orphaned=false` join filters where missing)
- Create: `services/social/src/orphan.test.mjs`
- Test: `bun test src/orphan.test.mjs` (mocked pool asserting transaction boundaries)

**Interfaces:**
- Produces: `export function orphanRangeSql(chainId, fromBlock, toBlock): { statements: string[]; transaction: true }` — all derived-table orphan updates (`chain_logs`, `markets`, `trades`, `venue_swaps`, `asset_transfers`, and any other table with `orphaned`) issued inside ONE transaction (`BEGIN; … COMMIT;` via `pool.query` with a client), ordered so `chain_logs` is last after its dependents; returns the ordered statements for tests.
- Analytics: every query that powers wallet analytics/leaderboard/trader rankings filters `orphaned=false` on all joined ledger tables (existing filters at `:176`, `:269`, `:382`, `:1132` are the model; find and fix the gaps the prior review found — a reorged-away market contributing to rankings).

- [ ] **Step 1: Write the failing test** — (a) `orphanRangeSql` yields a statement list with `BEGIN`/`COMMIT` framing when run through a client-mocked pool; (b) the statement order has no derived table orphan update after `chain_logs`; (c) asserting double-orphan undo: re-canonicalizing `chain_logs` alone (I2) is impossible — the sweep requeues dependent orphans in the same tx; (d) each analytics query fixture excludes an `orphaned=true` market from the ranking result set.

- [ ] **Step 2: Run the test to verify it fails** — `bun test src/orphan.test.mjs` → FAIL

- [ ] **Step 3: Implement** — wrap the orphan sweep in a single transaction using `pool.connect()` and `client.query('BEGIN')/…/COMMIT` with try/catch rollback; add the missing analytics filters; keep the existing per-table upserts for the *rebuild* path unchanged.

- [ ] **Step 4: Run the test to verify it passes** — `bun test src/orphan.test.mjs` → PASS; full `bun test` green.

- [ ] **Step 5: Commit**

```bash
git add services/social/src/indexer.mjs services/social/src/orphan.test.mjs services/social/src/performance.mjs services/social/src/pulseSql.mjs services/social/src/server.mjs
git commit -m "fix(indexer): transactional orphan propagation and analytics exclusion (I2, I7)"
```

### Task 6: Log-position stability, asset orphan, outbox retraction (I9, I3, I4)

**Files:**
- Modify: `packages/db/drizzle` (2 migrations: `assets.orphaned` boolean default false; `notification_outbox.retracted` boolean default false)
- Modify: `services/social/src/indexer.mjs` (upsert conflict targets for `asset_transfers`/`venue_swaps` on `logical_id`; `catch` around the range insert that retries once after re-fetching the canonical block; metadata purge for orphaned assets)
- Modify: `services/social/src/worker.mjs` / `outboxHub.mjs` (retraction pass: rows whose source row is orphaned get `retracted=true`; SSE clients receive a retraction event)
- Create: `services/social/src/retraction.test.mjs`
- Test: `bun test src/retraction.test.mjs`

**Interfaces:**
- Produces: `export function retractNotificationsSql(chainId): string` — updates `notification_outbox` to `retracted=true` where linked `chain_logs`/source rows are `orphaned=true`; `export function upsertAssetTransferSql(...)` — `ON CONFLICT (logical_id) DO UPDATE` including `block_hash` (position-shift safe); `export function markAssetsOrphanedSql(chainId, fromBlock, toBlock)`.

- [ ] **Step 1: Write the failing test** — (a) `retractNotificationsSql` marks rows retracted only when linked source is orphaned; (b) `upsertAssetTransferSql` does not abort when `log_index` shifts (assert conflict target is `logical_id` and `block_hash` is updated); (c) `markAssetsOrphanedSql` sets `orphaned=true` for the range and a following metadata refresh purges their stored metadata; (d) outbox retraction emits a retraction to SSE subscribers (mock hub).

- [ ] **Step 2: Run the test to verify it fails** — `bun test src/retraction.test.mjs` → FAIL

- [ ] **Step 3: Implement** — apply the migrations, adjust the upserts, add the range-retry wrapper around the failing insert path (one retry after re-fetch, then rethrow so the advisory-lock sweep restarts), add the outbox retraction pass in the worker, update `.env.example` if any new env is introduced (aim: none).

- [ ] **Step 4: Run the test to verify it passes** — `bun test src/retraction.test.mjs` → PASS; `bun run --cwd ../../packages/db build && bun test` per service green.

- [ ] **Step 5: Commit**

```bash
git add packages/db/drizzle services/social/src/indexer.mjs services/social/src/worker.mjs services/social/src/outboxHub.mjs services/social/src/retraction.test.mjs
git commit -m "fix(indexer): reorg-safe upserts, asset orphan, outbox retraction (I3, I4, I9)"
```

### Task 7: Docs + prior-review delta

**Files:**
- Modify: `docs/architecture/social-trading-backend.md` (status section: finalized confirmations, rate limits, orphan propagation, retraction)
- Modify: `docs/audits/dreadnode-2026-10-18/README.md` or add `docs/audits/STATUS.md` mapping each finding (M1, L1-L4, I1-I9) to commit/fix/status
- Test: none (doc-only)

- [ ] **Step 1: Update the architecture doc** — mark "Still required" items now done (shared validation, rate limiting), and record the new finality/retraction behavior.
- [ ] **Step 2: Write `docs/audits/STATUS.md`** — table: finding | severity | status (Fixed in `<commit>` / Open / By design) | verification (test file).
- [ ] **Step 3: Commit**

```bash
git add docs/architecture/social-trading-backend.md docs/audits/STATUS.md
git commit -m "docs: off-chain hardening status and prior-audit delta"
```

---

## Self-Review

- **Spec coverage:** M1 (Task 1), input validation (Task 2), rate limiting (Task 3), I1 (Task 4), I2+I7 (Task 5), I3+I4+I9 (Task 6), docs (Task 7). Lows from the artwork path covered by Task 3 (burst guard + edge limit doc).
- **Step scan:** each task ends with a runnable test and commit; DB work pinned to mocked-pool tests so CI stays green without live Postgres.
- **Type consistency:** `consume(key, opts)` from Task 3 used by server wiring in the same task; query-builder exports from Tasks 4-6 consumed only by their own tests and the modified indexer.
- **Review Focus:** default-admin hard error (Task 1), 400-before-SQL (Task 2), fail-open-on-DB-error with budget-still-bounded (Task 3), deep-reorg recovery (Task 4), analytics exclusion (Task 5), retraction + position-shift (Task 6).
- **Proportion:** 7 tasks; Task 4-6 split by finding pair to keep each diff reviewable; indexer touches are surgical (query builders + sweep wiring), not rewrites.