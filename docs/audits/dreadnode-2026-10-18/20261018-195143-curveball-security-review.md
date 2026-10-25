# Curveball security review

**Target:** `curveball.fun` — RISE launchpad (Solidity singletons, social service, keeper, Vercel API)
**Method:** Dreadnode traced agent sessions + `curveball-security` capability, with every finding reproduced locally
**Baseline:** `forge test` 138/138 passing, `slither` 20 findings (10 Low / 9 Medium / 1 High), before and after

---

## How this review was run

A project-local capability, `curveball-security`, was authored and installed on the runtime. It
ships three skills that encode the _trust model_ rather than generic advice:

- `curveball-threat-model` — asset inventory, the ten invariants the Foundry suite already pins,
  and an explicit list of ADR-0003 tradeoffs that must **not** be reported as bugs.
- `launchpad-solidity-review` — the specific functions worth attacking, with the questions to answer.
- `offchain-service-review` — auth/authz, SQL construction, SSRF, indexer consistency, keeper, ops.

The review then ran as a traced headless session:
`dn --print --capability curveball-security --prompt "…"` → session `f9ed83ec`, 51 messages,
30 tool calls, 1.1M tokens, $0.10, replayable.

Two independent review passes produced findings. The agent's pass covered off-chain auth/authz
and SQL construction and returned a route-by-route inventory. Findings below marked **[verified]**
were reproduced by me with a runnable artifact; **[confirmed by reading]** means the code path was
traced by hand and the mechanism is unambiguous, but no test was written.

---

## Findings

### 1. [Medium] Moderator role fails open to a hardcoded address **[confirmed by reading]**

`services/social/src/config.mjs:45`

```js
const admin =
  process.env.SOCIAL_ADMIN_ADDRESS?.trim() ||
  "0x5cc42e772f67089b4670eec4dcd904be2f2d511c";
```

Every other privileged input is either `required()` (throws if unset — see `databaseUrl` at
`config.mjs:53`) or validated (`:46`). The admin address alone has a **silent fallback**. A
deployment that forgets `SOCIAL_ADMIN_ADDRESS` — or misspells it — grants report-read and
moderation (`GET/PATCH /v1/admin/reports`) to an address the operator never chose.

The misconfiguration is invisible in development because `services/social/.env.example:9` ships
the _same address_, so a local run looks correct.

Verified: the literal appears in both `config.mjs` (1 occurrence) and `.env.example` (1 occurrence).
Fix: `required("SOCIAL_ADMIN_ADDRESS")`.

### 2. [Medium] Keeper aborts healthy markets on a transient RPC error **[verified]**

`keeper/graduation-keeper.mjs:107-114` and `:144-166`

`simulates()` wraps `simulateContract` in a bare `try/catch` and returns `false` for _any_ throw.
The caller treats `false` as "graduation reverts":

```js
const graduationReverts =
  needsGraduation &&
  !(await simulates("graduate", launchpad, launchpadAbi, token));
```

A dropped connection, an HTTP 429 from the RPC provider, or a malformed response is therefore
indistinguishable from an on-chain revert. Past `GRADUATION_TIMEOUT` (7 days) this makes `decide()`
return `"abort"`, permanently moving a sold-out market into the sticky `Aborted` state — while
`graduate()` would have succeeded on the next attempt.

Reproducer (`abort-on-rpc-error.proof.mjs`, 2 tests, both passing):

```
✔ FINDING: a transient RPC error makes the keeper ABORT a healthy sold-out market
✔ control: an actual revert past the timeout SHOULD abort
```

The first test injects `HttpRequestError` (status 429) on the `graduate` probe only, and asserts
`abortGraduation` was written. The control test uses a real `ContractFunctionExecutionError`.

Impact: liveness only — no funds move, and the ADR explicitly treats abort as recoverable
(sells reopen, graduation works again when sold out). But a market pushed to `Aborted` on RPC
noise silently changes its trading semantics, and the keeper logs it as
`"Graduation would revert"`, which will send an operator looking in the wrong place.

Fix: discriminate on error kind before mapping to `false` — rethrow transport errors so `act()`
backs off and retries, and only treat a decoded revert as `graduationReverts`.

### 3. [Low–Medium] Attacker-controlled IPFS metadata reaches a raw `<img src>` **[verified]**

`services/social/src/metadata.mjs:44` + `src/components/TokenAvatar.tsx:38`

The server-side metadata fetch enforces a host allow-list on the _document_ URL
(`publicUrl(uri, true)` at `:28`) but drops the flag on the two URLs taken _from_ that document:

```js
imageUrl: publicUrl(value.image),          // enforceHost defaults to false
externalUrl: publicUrl(value.external_url),
```

`publicUrl(uri, false)` returns any `https:` URL — no host restriction.

That value flows to the client (`server.mjs:389` `imageUrl: row.token_metadata?.imageUrl`) and is
rendered without checking:

```tsx
<img className={`token-avatar ${className}`.trim()} src={source} alt="" … />
```

**Exploit:** `launch()` takes a `uri` and emits it; the indexer stores it as `metadata_uri`
(`indexer.mjs:411`) and the metadata worker fetches it. A creator publishes IPFS metadata whose
`image` is a URL on their own host, then watches every viewer's IP, User-Agent, and Referer arrive
on every render. No authentication is needed — launching is permissionless.

I probed the boundary directly (`/tmp/urltest.mjs`) and confirmed the host check is otherwise solid:
`https://gateway.pinata.cloud@evil.com/` → blocked, `https://gateway.pinata.cloud.evil.com/` →
blocked, non-HTTPS → blocked. The `enforceHost=false` on these two fields is the whole gap.
`external_url` is never rendered, so it is untrusted-but-unused today.

Fix: pass `enforceHost = true` for `imageUrl`, or restrict it to the configured gateway. Note the
client cache is unbounded (`tokenMetadata.ts:3`), so this is also a memory-growth vector.

### 4. [Low] A donation opens the pool at an unbounded premium **[verified]**

`contracts/contracts/CurveLaunchpad.sol:308-315`

The `graduate()` doc comment says a WETH donation synced into a pre-created pool is "matched with
tokens from the burn buffer, so the opening price equals the curve-end spot; **beyond the buffer
the pool opens slightly higher at the donor's expense**."

The token side of `tokensToPool` is capped by the buffer, but `quoteInPool = realQuote + quoteReserve`
is not capped at all. Measured (`DonationBound.t.sol`, passing):

| donation | pool opening spot (x18) | vs. curve-end spot                   |
| -------- | ----------------------- | ------------------------------------ |
| 0        | 25,000,000,000,000      | 1.00×                                |
| 1 ether  | 25,000,000,000,000      | 1.00× (within buffer, as documented) |
| 2 ether  | 30,000,000,000,000      | 1.20×                                |
| 5 ether  | 45,000,000,000,000      | 1.80×                                |
| 50 ether | 270,000,000,000,000     | **10.80×**                           |

So "slightly higher" scales linearly with the donation, without bound. The donor certainly pays
(all donated WETH is in the pool), so this is not free manipulation of others' funds — but the
pool can be opened at an arbitrarily high price, which changes the starting point for every
immediate post-graduation trade and for the protocol's own TWAP-based buyback.

Two probes passed confirming the ADR's other claims: a donated WETH balance does **not** block
graduation, and the pre-graduation transfer lock (`CurveToken._beforeTokenTransfer`) does prevent
any third party from seeding the pool's token side (`DonorPoisoning.t.sol`, 3 tests passing).

Report it as an intent gap — the code is internally consistent, the _documented_ characterization
is what is wrong. Worth a comment fix at minimum, and a decision on whether the opening price
should be bounded.

### 5. [Low] Unvalidated cursors and out-of-range ids produce 500s **[verified]**

`services/social/src/server.mjs:103-111`, `:449`, `:280`, `:498`, `:829-832`

`decodeCursor` base64url-decodes attacker-controlled JSON and validates only that it is an object.
Consumers then type-check individual fields with `typeof === "string"`, so a cursor like
`{"at":"x"}` is forwarded to a `$4::timestamptz` cast and Postgres raises, yielding a 500 plus a
`console.error`.

The `/v1/notifications/read` filter accepts `Number.isInteger(id) && id >= 0` **or** a `/^\d+$/`
string. The integer branch is unsafe at the top of the double range. Verified against the bundled
`pg` (`generate=pg@8.23.1`):

```
input=1e+21              isInteger=true  isSafeInteger=false  pg="{\"1e+21\"}"
input=9007199254740992   isInteger=true  isSafeInteger=false  pg="{\"9007199254740992\"}"
```

`String(1e21)` → `"1e+21"`, which is not a valid `bigint` literal, so `{"ids":[1e21]}` reaches
`=ANY($3::bigint[])` and errors.

Neither is injection — everything is a bound parameter. Both are trivially-triggered error-log
amplification and, at `9007199254740993`, silent precision loss. Fix: validate the decoded cursor
shape per route (or sign it), and bound ids with `Number.isSafeInteger`.

### 6. [Informational] `discoverable` is not enforced on profile or feed **[confirmed by reading]**

`server.mjs:301`, `:277`, `:804` vs. `:358`

`discoverable` gates the leaderboard (`:358`, `AND p.discoverable=true`) and the performance
snapshot (`performance.mjs:83`) but not `/v1/profiles/:address` (`:301` returns the profile row
unconditionally, including `display_name` and `bio` at `:331-332`), the trade feed's
`LEFT JOIN profiles p` (`:277`), or the notifications join (`:804`).

An address is always usable as a key, so a profile is reachable by anyone who knows the wallet
regardless. This needs a **product-intent call** before being treated as a bug: if `discoverable`
means "hide me from listings", the leaderboard is right and this is fine; if it means "don't show
my display name to strangers", the profile and feed are wrong. Flagging it as a question, not a
finding.

### 7. [Informational] SQL interpolation is currently safe but structurally fragile **[confirmed by reading]**

`server.mjs:446-457`

`markets()` concatenates `${statusClause}`, `${orderExpression}`, and `${cursorClause}` into the
query string. This is **not injectable today** — I traced the guard order: `tab` is allow-listed at
`:438` _before_ any fragment derives from it at `:446-450`, and `cursor.tab` is compared against
`tab` at `:443` so the two cannot diverge.

The hazard is that the safety lives in statement _ordering_ rather than in the type of the
interpolated value. Converting to a static fragment map keyed by the already-validated `tab` makes
the property local. `indexer.mjs:282,285` interpolates `${table}` but only from module-level `const`
arrays (`:272-273`) — safe, and I checked; it does not need changing.

### 8. [Informational] Unauthenticated route performs a DB write and an outbound fetch, unthrottled **[confirmed by reading]**

`server.mjs:634-638` → `resolveRns` (`:172-208`)

Any anonymous caller can drive a cache-miss `INSERT … ON CONFLICT DO UPDATE` into `rns_cache`
(`:204`) plus an outbound request to the configured resolver (`:181`) per distinct 40-hex address.
The path segment is regex-constrained, the base URL is fixed, and the response is validated, so
this is not SSRF. It is unbounded cache growth and request amplification against a third-party
resolver. There is **no rate limiting anywhere in the service** (grep for
`ratelimit|throttle|too many` returns nothing).

---

## Tooling gaps found during the review

These are environment/repo issues that block any reviewer, not Curveball vulnerabilities:

1. **`forge build` fails on a fresh checkout.** `contracts/node_modules` was missing `solady` and
   `forge-std`, so the first build attempt fails with `Source "node_modules/solady/src/tokens/ERC20.sol" not found`.
   `bun install --frozen-lockfile` fixes it. `scripts/setup.sh` in the capability now repairs this
   automatically.

2. **`slither` fails out of the box.** It invokes `forge build` internally and dies on the same
   missing-import error with `out/build-info is not a directory`. Same fix.

3. **Dreadnode packaging bug (upstream, not Curveball).** On Python 3.14,
   `dn --print` fails with `module 'litellm' has no attribute 'types'` from
   `dreadnode/generators/generator/litellm_.py:1047` (`litellm.types.utils.StreamingChoices`). The
   bare attribute access races litellm's lazy submodule loading; the same file imports it correctly
   at `:1013`. Reproduced on `dreadnode 2.0.51` with the pinned `litellm==1.101.3` under Python
   3.14.6, and **not** under Python 3.12.13. Workaround: install the tool under Python 3.12.

4. **Port 8787 conflicts** with an unrelated SSH tunnel on this host; `dn serve` had to bind 8791.

---

## What the baseline tools missed

| Finding                       | Slither | Forge tests | Agent+capability |
| ----------------------------- | ------- | ----------- | ---------------- |
| 1. Admin fails open           | —       | —           | ✓                |
| 2. Keeper aborts on RPC error | —       | —           | ✓                |
| 3. IPFS → `<img src>`         | —       | —           | ✓                |
| 4. Unbounded donation premium | —       | —           | ✓                |
| 5. Cursor/id 500s             | —       | —           | ✓                |
| 6. `discoverable` gap         | —       | —           | ✓                |
| 7. SQL interpolation (safe)   | —       | —           | ✓ (cleared)      |
| 8. RNS amplification          | —       | —           | ✓                |

Slither's 20 findings were all in the Solidity layer and all triaged as already-known or
non-actionable — the invariant suite covers them. It reported `reentrancy-no-eth`,
`missing-zero-check`, `divide-before-multiply`, `unused-return`, and `timestamp`; none reaches
funds, and the ADR documents the pause/guardian/owner bounds that make them moot. **Every
actionable finding above is off-chain or in a contract's documented intent.** That is the gap the
capability was built to close.

---

## Reproducing

```bash
# capability
dn capability install ./curveball-security
dn serve --port 8791 --working-dir . &
dn --runtime-server http://127.0.0.1:8791 --print --capability curveball-security \
   --prompt "Use the offchain-service-review skill. Review steps 1 and 2 …"

# finding 2
cd keeper && cp ../.review-baseline/abort-on-rpc-error.proof.mjs . \
  && sed -i '' 's#from "curveball-keeper".*#from "./graduation-keeper.mjs";#' abort-on-rpc-error.proof.mjs \
  && node --test abort-on-rpc-error.proof.mjs

# findings 4
cp .review-baseline/evidence/Don*.t.sol contracts/test/unit/
cd contracts && forge test --match-contract "DonorPoisoning|DonationBound" -vv

# baseline
cd contracts && forge build && forge test && slither . --filter-paths node_modules
```

Artifacts live in `.review-baseline/` (gitignored-adjacent; not committed).

---

## Limitations

- Off-chain steps 3–6 were reviewed by hand and by the agent's structural pass, **not** by a full
  dynamic run. The indexer's reorg path (`indexer.mjs`, 953 LOC) deserves a dedicated pass with a
  live database — statically I did not find a divergence, but absence of evidence here is weak.
- No live-deployment testing was performed. `cast` was not pointed at the RISE testnet deployment.
- The keeper finding is proven against the module's _decision_ path with a mocked client. It does
  not demonstrate a real RPC failing during a real window — that requires a live keeper and an
  induced provider fault.
- `forge test` and `slither` were run on my checkout, which needed `bun install` first. The 138/138
  baseline is post-repair.
- The `@privy-io/node` audience validation (finding 11 in the agent's report) was verified by the
  agent reading `node_modules/@privy-io/node/lib/auth.mjs`, not by minting a mismatched token.
