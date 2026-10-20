---
name: offchain-service-review
description: Use when reviewing the Curveball off-chain services for security issues — the social service (server.mjs, privyAuth.mjs, indexer.mjs, metadata.mjs), the graduation keeper, the Vercel artwork API, Docker/env wiring, or leaked credentials. Covers auth and authorization, SQL construction, SSRF, CORS, secret handling, and reorg/consistency bugs that static Solidity tools cannot see.
---

# Curveball off-chain review

Roughly 2,400 LOC of Node in `services/social/`, 247 in `keeper/`, and a Vercel
serverless function in `api/`. None of it is visible to Slither. This is where a review
earns its fee — the contracts already have 138 tests and an invariant suite; the off-chain
side has near-total test coverage gaps.

Trust boundaries to hold in your head:

```
browser ──Privy JWT──▶ social API ──▶ Postgres
                          │
                          ├──▶ RISE RPC (indexer)
                          ├──▶ RNS resolver (api.stage0.xyz)
                          └──▶ IPFS gateway + token metadata (arbitrary HTTPS)

keeper ──private key──▶ RISE RPC ──▶ launchpad/escrow
```

## Verified tooling setup (do this first)

Two environment traps cost time on the last pass. Both are repaired by `scripts/setup.sh`,
but check before you start:

1. **`forge build` fails on a fresh checkout** with
   `Source "node_modules/solady/src/tokens/ERC20.sol" not found` — `contracts/node_modules` is
   missing `solady` and `forge-std`. `bun install --frozen-lockfile` at the repo root fixes it.
   `slither` dies on the same error (it shells out to `forge build`) with the misleading
   message `out/build-info is not a directory`.
2. **To review the indexer's SQL, stand up a real database** rather than reasoning about it:

```bash
docker run -d --name curveball-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres \
  -e POSTGRES_DB=curveball -p 55432:5432 postgres:15-alpine
cd packages/db/drizzle && for f in *.sql; do
  docker exec -i curveball-pg psql -U postgres -d curveball -v ON_ERROR_STOP=1 -q < "$f"
done
```

Then replayed the indexer's verbatim SQL against it. A reorg is two UPDATE statements followed by
a re-INSERT — you can reproduce the whole cycle in a few dozen lines, and it is far more convincing
than a paragraph of reasoning. `scripts/reorg-harness.mjs` is a working starting point: point its
connection string at the container and run it.

For a genuine fork rather than a SQL replay, `anvil_snapshot` before the emitting transaction,
then `anvil_revert` + `anvil_mine`. `anvil_reorg`'s parameter shape is version-dependent and often
rejects `[depth, []hash]`; snapshot/revert produces the same observable and always works.

## Step 1 — authentication and authorization

`privyAuth.mjs` is the root of trust for every authenticated route. Get this right first.

The flow: verify the Privy access token → read the `x-curveball-wallet-address` header →
confirm that address is one of the user's *linked Ethereum wallets*.

Questions worth answering with evidence:

- `verifyAccessToken` — is the token audience/issuer checked? A Privy token minted for a
  *different* app would be rejected only if the SDK checks `aud`. Confirm what it validates
  rather than assuming.
- The `ACTIVE_WALLET_HEADER` is attacker-controlled. The code then verifies it belongs to
  the token's user — that is the correct pattern. Verify the `ethereumWallets` filter
  cannot be satisfied by a non-`ethereum` or non-`wallet` linked account, and that the
  address comparison is normalized on both sides (it lowercases; confirm `getAddress`
  cannot throw on a malformed header *after* the `isAddress` gate).
- The `userCache` is keyed by `user_id` with a 30s TTL. If a user unlinks a wallet in
  Privy, that wallet stays authorized for up to 30 seconds. Is that acceptable? Quantify
  the window and state it as a low-severity note if so.

Then walk every route in `server.mjs` and classify:

- `requirePrivyWallet(request)` — authenticated + origin-checked
- `requirePrivyWallet(request, false)` — authenticated, **no origin check**
- `requireModerator(...)` — authenticated + admin address match
- `viewerFor(request)` — best-effort, returns `null` on failure

Enumerate the routes and confirm the level matches the operation. Two things to check
specifically:

- `/v1/admin/reports` calls `requireModerator(request, false)` — no origin check. Is that
  a CSRF exposure? (Requires a bearer token, so probably not — but say why, with the
  request shape that would be needed.)
- Any state-changing route that uses `viewerFor`/no auth at all. `/v1/events` is a
  single SSE feed shared by all clients — confirm its payload cannot carry per-user data.

## Step 2 — SQL construction

Every query should pass values as `$n` parameters. The review target is anything
interpolated into the query *string*.

`server.mjs` builds `markets()` by template-literal concatenation:

```js
const statusClause = tab === "graduated" ? "AND m.graduated=true" : ...;
const orderExpression = tab === "trending" ? "recent_gross_quote_volume" : "m.launched_at";
... `WHERE m.chain_id=$1 ... ${statusClause} ${cursorClause} ORDER BY ${orderExpression} DESC ...`
```

The interpolated fragments are chosen by ternary from literals and the `tab` value is
validated against an allow-list first, with `cursor.tab` also checked. That means it is
**not** currently injectable — but the pattern is one refactor away from being one, and the
`cursor` callback is attacker-controlled JSON.

Your job: verify the allow-list actually precedes every use, trace whether `cursor.tab`
can differ from `tab` on any path, and report the pattern as a hardening item with the
exact line. Also check `indexer.mjs` `retirePreviousDeployment` — it interpolates
`${table}`, but from a module-level `const` array, so that one is safe; say so.

Check `boundedLimit` and `marketCandles`'s `interval` allow-list, and the `ids` filter in
`/v1/notifications/read` (`/^\d+$/` on strings, integers permitted directly) — can a
non-numeric value reach `=ANY($3::bigint[])`?

## Step 3 — SSRF and outbound fetches

Two places fetch attacker-influenced URLs:

- `metadata.mjs` `fetchMetadata` → `publicUrl(uri, true)`. It forces HTTPS and, with
  `enforceHost`, restricts to `config.metadataHosts`. The IPFS branch strips `ipfs://` and
  applies a CID regex — check the regex strictly (it permits an optional `/<path>` suffix).
  Can `ipfs://` + carefully crafted path escape the gateway? Can a `https` URL with
  credentials (`https://user@host/`) or a non-standard port bypass the host check? Test the
  `new URL()` parse and the hostname comparison directly in Node.
- `server.mjs` `resolveRns` → `fetch(config.rnsApiUrl + address)`. `address` is validated
  as an Ethereum address before it reaches here (via `addressParam`/route regex). Confirm
  that on the route, and confirm `rnsApiUrl` is a fixed trusted base.

For each, the question is: what is the most an attacker can make the server fetch, and
what do they learn from the response or the timing?

## Step 4 — consistency and liveness (the indexer)

`indexer.mjs` (953 LOC) maintains the off-chain ledger from chain logs. Reorg handling is
where these systems break silently.

**Four independent streams** (`factory`, `trades`, `ledger`, `venue`), each with its own cursor
row in `chain_cursors`, each wrapped in one transaction, each orphaning only its own topics
(see `lifecycleTopics` vs `tradeTopic`). Confirm that separation holds before hunting further —
it is correct and deliberate.

The parts that are genuinely right, so you do not waste time re-deriving them: every range is
transactional; `market_stats`/`market_candles`/`curve_positions` are *rebuilt from
`WHERE orphaned=false`* rather than patched, so they self-heal; lifecycle state is re-read from
the chain at `toBlock` for every touched market, including freshly-orphaned ones; single-writer
leadership is held via `pg_try_advisory_lock` on a dedicated connection. **I found no divergence
in the derived analytics tables.** Spend your effort on the bookkeeping around them.

Where to look instead:

- **`recordOccurrence` un-orphans unconditionally.** It is keyed on `(chain_id, block_hash, log_index)`
  and its `ON CONFLICT DO UPDATE` sets `orphaned=false`. Because `scanStream` deliberately overlaps
  `REORG_OVERLAP` (16) blocks, it re-reads already-seen blocks on every tick. If it re-reads a
  *superseded* branch, the `chain_logs` row is marked live while `trades`/`markets` for it stay
  orphaned. Nothing reconciles the two.
- **`parent_hash` and `canonical` are written and never read.** There is no chain-continuity check
  anywhere. A reorg is handled by "orphan this range, re-insert whatever the RPC returns" — which
  converges per-stream, per-topic, not because a fork was detected. `anvil_snapshot`/`anvil_revert`
  makes this testable: same height, new hash, log gone.
- **`REORG_OVERLAP` (16) vs `SOCIAL_CONFIRMATIONS` (default 2, shipped as 2).** `recordBlock` and
  `recordOccurrence` write `finalized=true` unconditionally at 2 confirmations, but only 16 blocks
  are revisitable. Nothing asserts `confirmations <= REORG_OVERLAP`. A deeper fork is permanent.
- **`assets` has no `orphaned` column** and is in neither derived-table list. A market row correctly
  orphans; its `assets` row survives forever, and `metadata.mjs` re-fetches that dead token's IPFS
  URI every 24h. Note the blast radius honestly: `assets` is only read via `LEFT JOIN` inside
  `marketSelect`, gated on `m.orphaned = false`.
- **`notification_outbox` is append-only and never retracted.** The trade range deletes from
  `notifications` but not from the outbox, which is the SSE feed's source. A live client receives
  events for orphaned trades; a fresh client starts at `MAX(id)` and does not. It also grows unbounded.
- **`reserve_rounds`** has an `orphaned` column, is in neither list, and is never read or written —
  a V1 leftover. Deleting it is a cleanup, not a finding.
- **The ledger stream rebuilds no derived state.** `indexLedgerRange` reconstructs transfers/flows
  but never calls `rebuildCurvePosition`/`rebuildMarketStats` (only the trade and venue streams do).
  So orphaning an `asset_transfers` row leaves `curve_positions` stale, and the profile query's
  `COALESCE(tb.balance, cp.known_basis_token_balance, 0)` silently falls back to it — a wrong
  number, no error, and it self-heals only on the next trade in that token.
- **A market orphaned without its trades.** `indexTradeRange` never writes `markets.orphaned`, so a
  reorged-away market disappears from listings while its trades keep counting in `statsSql` and in
  `performance.mjs` leaderboards. Check both sides of that asymmetry.
- **`trades` has two unique constraints.** The PK is `logical_id`; there is also
  `trades_chain_log_uidx` on `(chain_id, transaction_hash, log_index)`. Inserts specify
  `ON CONFLICT (logical_id)`, which does not arbitrate the second one — a re-included tx whose logs
  shift indexes raises `23505` and rolls back the entire range transaction (stuck stream, not
  corrupted data). Check every table with more than one uniqueness guarantee.

Cheap checks that pay off: `grep -rn "parent_hash\|canonical" services/social/src/` (writes only?),
`grep -rn "notification_outbox" … | grep -i "delete\|orphan"` (empty?), and a live Postgres with the
drizzle migrations applied so you can replay the SQL rather than reason about it.

**Watch the working tree.** This repo is under active development, sometimes by a concurrent agent —
during the last pass HEAD moved and `server.mjs`/`performance.mjs` changed underneath the review.
Pin the commit you reviewed, note it in the report, and re-verify line references at the end. The
findings that live in `indexer.mjs` and `packages/db` were stable; the ones in the HTTP layer drifted.

**A cross-check pass is worth it.** A second, narrower session ("I have already confirmed X, Y, Z — do
not re-report them; find anything new about A, B, C") surfaced two real findings the first pass
missed, and let me kill one hypothesis I had recorded as possibly serious. Explicitly forbidding the
known findings is what makes it productive rather than repetitive.

## Step 5 — the keeper

`keeper/graduation-keeper.mjs` — read the exported `decide()` table and the retry/backoff
logic. It holds a funded key, so liveness matters.

- `decide()`: walk every (state × soldOut × graduationReverts × buyback) combination and
  confirm it matches the documented table in `keeper/README.md`. An incorrect branch means
  markets that never graduate, or `abort` fired when `graduate` would have worked.
- `simulates()` swallows all errors and returns `false`. A transient RPC failure therefore
  looks identical to "graduation reverts," which after the timeout triggers **abort**.
  Is that a real risk? Trace what an abort costs the protocol when graduation was actually
  possible. This is a prime candidate for a genuine finding.
- Nonce handling: sends wait on a pending nonce. What happens if a sent tx is dropped from
  the mempool — does the keeper stall forever? Read the swap/retry path.
- Backoff caps at 6 hours. Is there any state that backoff makes permanently unreachable?
- The keeper never persists a cursor and rescans from `deploymentBlock` each start. What is
  the cost and failure mode at scale?

## Step 6 — secrets, deployment, and ops

- `agent_wallet` (a Foundry keystore JSON) is present in the working tree and gitignored.
  Confirm it was never committed (`git log --all -- agent_wallet`) and that `.gitignore`
  covers it. Do not decrypt it or print it — report presence and exposure path only.
- `git check-ignore` every env file; confirm the ones with real values are ignored and only
  `.env.example` templates are tracked.
- Grep tracked files for high-entropy values: RPC URLs with embedded keys, `sk-`, `eyJ`
  JWTs, 64-hex strings in non-hash positions. Report location + type, never the value.
- `compose.yaml` — are secrets passed as plain `environment:` entries (visible in
  `docker inspect`) rather than Docker secrets? Note it with the file/line.
- The production preflight is documented as gating on a mainnet fork, timelock owner, and
  contract guardian/treasury. Read `contracts/Makefile` and the preflight target to confirm
  the gates exist in code and are not bypassable by an env var.
