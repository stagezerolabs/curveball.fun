# Curveball off-chain review — Steps 1–2 only

Scope: Authentication/Authorization (step 1) and SQL construction (step 2) of
`curveball-security:offchain-service-review`. Steps 3–6 not reviewed.

## Route inventory — `services/social/src/server.mjs`

| # | Method | Path | Line | Auth level |
|---|---|---|---|---|
| 1 | OPTIONS | `*` | 616 | none (CORS preflight) |
| 2 | GET | `/health` | 624 | none |
| 3 | GET | `/v1/events` | 628 | none (shared SSE feed) |
| 4 | GET | `/v1/rns/primary/:address` | 634 | none |
| 5 | GET | `/v1/me` | 639 | `viewerFor` |
| 6 | POST | `/v1/me` | 640 | `requirePrivyWallet` (origin) |
| 7 | GET | `/v1/feed` | 645 | `viewerFor` (401 only for `scope=following`) |
| 8 | GET | `/v1/leaderboards/:category` | 646 | `viewerFor` |
| 9 | GET | `/v1/markets` | 647 | none |
| 10 | GET | `/v1/protocol/stats` | 648 | none |
| 11 | GET | `/v1/markets/:token/trades` | 650 | none |
| 12 | GET | `/v1/markets/:token/candles` | 654 | none |
| 13 | GET | `/v1/markets/:token/holders` | 658 | none |
| 14 | GET | `/v1/markets/:token` | 662 | none |
| 15 | GET | `/v1/profiles/:address` | 667 | `viewerFor` |
| 16 | POST | `/v1/profiles/me` | 673 | `requirePrivyWallet` (origin) |
| 17 | POST/DELETE | `/v1/follows/:address` | 685 | `requirePrivyWallet` (origin) |
| 18 | POST/DELETE | `/v1/blocks/:address` | 710 | `requirePrivyWallet` (origin) |
| 19 | POST | `/v1/reports` | 728 | `requirePrivyWallet` (origin) |
| 20 | POST | `/v1/trade-notes` | 738 | `requirePrivyWallet` (origin) + trade-owner check (744) |
| 21 | POST | `/v1/trade-reactions` | 754 | `requirePrivyWallet` (origin) |
| 22 | GET | `/v1/admin/reports` | 766 | `requireModerator(request, false)` — **no origin check** |
| 23 | PATCH | `/v1/admin/reports/:id` | 779 | `requireModerator` (origin) |
| 24 | GET | `/v1/notifications` | 796 | `requirePrivyWallet(request, false)` — **no origin check** |
| 25 | GET | `/v1/notification-preferences` | 811 | `requirePrivyWallet(request, false)` — **no origin check** |
| 26 | PATCH | `/v1/notification-preferences` | 816 | `requirePrivyWallet` (origin) |
| 27 | PATCH | `/v1/notifications/read` | 826 | `requirePrivyWallet` (origin) |

Net: 27 handlers, 3 with origin checking disabled, all three GETs.
No state-changing route is unauthenticated.

## Ranked findings

### 1. Medium — Moderator role fails open to a hardcoded default address
`services/social/src/config.mjs:45` — `const admin = process.env.SOCIAL_ADMIN_ADDRESS?.trim() || "0x5cc42e...511c"`.
Every other privileged input uses `required()` (DB URL) or throws on invalid (`:46`),
but an unset admin silently grants moderator to a baked-in address. `requireModerator`
(`server.mjs:88-92`) then gates `GET/PATCH /v1/admin/reports` on it. A deployment that
forgets the env var — or a misnamed var, since `services/social/.env.example:9` ships the
same value so the mistake is invisible in dev — hands report-read/moderation to an address
the operator never chose. Fix: make it `required()`.
Type: broken access control / fail-open configuration.

### 2. Medium — `discoverable=false` is not enforced on the read paths that expose display name
`server.mjs:301` (`profile()`) selects and returns `display_name`/`bio` with no `discoverable`
filter, and `server.mjs:270`/`277` (`feed()`) joins `profiles` unconditionally and returns
`p.display_name` for every trader. By contrast `leaderboards()` correctly requires
`p.discoverable=true` (`server.mjs:358`). So a user who turns off discoverability still has
their display name (and bio, on `/v1/profiles/:address`) served to anyone via routes 15 and 7,
while being hidden from route 8. Same field, three routes, inconsistent authorization
predicate — either the flag's intent is narrower than it looks, or this is an
information-disclosure bug. Confirm intent, then apply one predicate consistently.

### 3. Low–Medium — Unauthenticated route performs a DB write and an outbound HTTP fetch, unrate-limited
`server.mjs:634-638` → `resolveRns` (`:172-208`). Any anonymous caller can drive a cache-miss
`INSERT ... ON CONFLICT DO UPDATE` into `rns_cache` (`:204`) plus an outbound request to
`config.rnsApiUrl` (`:181`) for each distinct 40-hex address. Value is bounded (the
`0x[a-fA-F0-9]{40}` regex at `:634` constrains the path segment, `rnsApiUrl` is a fixed HTTPS
base, and the response is allow-listed by `RNS_NAME` at `:191`), so this is availability/cost,
not SSRF: unbounded cache growth, request amplification against the trusted stage0 resolver,
and log noise. Add a rate limit and/or make this cache-read-only for anonymous callers.

### 4. Low — Unsigned client-controlled cursors reach typed SQL casts and produce 500s
`decodeCursor` (`server.mjs:103-111`) base64url-decodes attacker-controlled JSON and validates
only that it is an object — no signature, no schema. Consumers then type-check just the fields
they care about with `typeof === "string"` (`:258-261`, `:444-445`, `:484-485`), so a cursor
like `{"at":"x"}` is forwarded to `$3::timestamptz` (`:280`) or `$4::timestamptz` (`:498`),
and `{"tab":"trending","value":"x"}` to `$4::numeric` (`:449`). Postgres raises a cast error →
uncaught → 500 and `console.error` (`:837-840`). Not injection (all parameters), but a free
error-log amplification vector. Validate the decoded cursor shape per route, or sign it.

### 5. Low — Non-numeric value does reach `=ANY($3::bigint[])` in `/v1/notifications/read`
The filter at `server.mjs:829-831` accepts any `Number.isInteger(id) && id >= 0` OR string
matching `/^\d+$/`. The string branch is safe. The **integer branch is not**: `pg`'s array
serializer stringifies via `String()`, so `1e21` becomes `"1e+21"`, which is not a valid bigint
literal. Confirmed locally: `prepareValue([1e21])` → `{"1e+21"}`, and `Number.isInteger(1e21)`
is `true`, so `{"ids":[1e21]}` reaches `:832` and errors with `invalid input syntax for type
bigint`. No injection is possible (bound parameter, and `arrayString` quotes it), but it is a
trivially-triggered 500. Bound the ids to a safe integer range (`id <= Number.MAX_SAFE_INTEGER`,
which also fixes silent precision loss at `9007199254740993`) before the cast. Same class as 4.

### 6. Informational — `requireModerator(request, false)` on `GET /v1/admin/reports` (`:767`) is not a CSRF exposure
The response is only readable if CORS allows the origin (`:21-29`), and the request requires
both `Authorization: Bearer` and the custom `x-curveball-wallet-address` header, so a
cross-site attacker cannot construct it without a successful preflight. Still worth fixing for
consistency — the sibling `PATCH` at `:781` does check origin, and the same omission exists at
`:797` and `:812`. Note the origin check is weak CSRF defense regardless: this API authenticates
with bearer tokens rather than cookies, so `requireOrigin` (`:57-62`) actually *denies*
non-browser clients, since it 403s when `Origin` is absent or unlisted.

### 7. Informational — 30-second stale-authorization window from the Privy user cache
`privyAuth.mjs:26,32-48`. The user record is cached per `user_id` for `cacheTtlMs = 30_000`.
If a user unlinks a wallet in Privy, that wallet remains an authorized curveball identity for up
to 30s. Window: ≤30s, only on cache hits — acceptable, but state it. The cache is keyed by the
`sub` of an already-verified token, so there is no cross-user poisoning.

### 8. Informational — `markets()` template interpolation is currently safe, but is one refactor from being injectable
`server.mjs:446-457` interpolates `${statusClause}`, `${orderExpression}`, and `${cursorClause}`
into the query string. Guard order traced: `tab` is validated against an allow-list at `:438`
**before** any fragment is derived at `:446-450`, and `cursor.tab` is compared to `tab` at `:443`,
so the two cannot diverge on any path (a cursor missing `tab` throws).
`recentVolumeExpression`/`marketSelect`/`statsSql` are module-level literals. Verdict: not
injectable today. The hazard is structural — safety lives in statement *ordering* rather than in
the type of the interpolated value. Convert to a static `sql` fragment map keyed by the
already-validated `tab` so the property is local and can't be reordered away.

### 9. Informational — `retirePreviousDeployment` table interpolation is safe (confirmed)
`indexer.mjs:282,285` interpolate `${table}`, but only from the module-level `const` arrays
`DERIVED_TABLES_TO_ORPHAN`/`DERIVED_TABLES_TO_CLEAR` (`:272-273`). No attacker-influenced value
reaches them. Outside `server.mjs`, these are the only SQL-affecting interpolations in
`services/social/src/` — the other 15 `${}` sites in the indexer are event keys, error strings,
and analytics constants.

### 10. Informational — two smaller correctness issues on the auth/param edges
- `viewerFor` (`server.mjs:73-79`) swallows all auth errors and returns `null`, so an expired or
  invalid token is indistinguishable from anonymous on routes 5/7/8/15 — `GET /v1/me` answers
  `{"address":null}` instead of 401. Not a vulnerability, but it hides session expiry from clients.
- `addressParam` (`server.mjs:17-19`) returns `null` for a mixed-case address that fails the
  EIP-55 checksum, while the route regex at `:634` accepts any `[a-fA-F0-9]{40}`. A request like
  `/v1/rns/primary/0xAbCD…` therefore passes the route match, yields `address = null`, and issues
  an upstream fetch for the literal string `"null"` plus a null-keyed cache write. Low impact
  (fixed base URL), but the route should reject non-checksummed mixed case or normalize before
  matching.

### 11. Informational — Privy token verification does validate audience (skill question, answered with evidence)
`node_modules/@privy-io/node/lib/auth.mjs` passes `audience: appId`, `issuer: 'privy.io'`,
`algorithms: ['ES256']` to `jose.jwtVerify`, so a token minted for a different Privy app is
rejected. Residual notes: the shared `verifyPrivyIssuedJwt` serves both access and identity
tokens with the same claims check, and no `sid` session binding or revocation check is performed
— the 30s cache in finding 7 is the only freshness control. `ethereumWallets`
(`privyAuth.mjs:16-22`) cannot be satisfied by a non-`ethereum`/non-`wallet` linked account, and
`getAddress` at `:73` cannot throw because the `isAddress` gate at `:62` precedes it (verified
against viem 2.57.5: `isAddress` rejects bad checksums and wrong lengths; `getAddress` throws only
on those).

## Scope notes
Steps 3–6 (SSRF in `metadata.mjs`, indexer reorg consistency, the keeper, secrets/deploy) were not
reviewed, so nothing here clears them — in particular the SSRF surface in `fetchMetadata`/`publicUrl`
and the `ipfs://` CID regex are untouched. Finding 2 needs product-intent confirmation. Findings 4
and 5 were verified by executing the relevant `pg`/`viem` behavior locally rather than by reasoning.
