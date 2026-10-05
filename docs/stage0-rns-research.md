# Stage0 RNS production integration research

Research date: 2026-09-19. Sources are first-party Stage0 documentation and the live Stage0 RNS API only.

## Executive recommendation

Use Stage0's public REST API as the app's RNS read layer:

- Call `GET /v1/reverse/{address}` to choose the single display name for a connected wallet.
- Call `GET /v1/addresses/{address}/names` when the UI needs the complete set of active names the wallet owns, including names held in marketplace custody.
- Fall back to the shortened wallet address whenever `primaryName` is `null`, the request fails, or the response is stale/untrusted.
- Normalize Stage0 responses inside one app-owned adapter. In particular, do not make UI code depend on every field currently returned for an owned name, because the OpenAPI schema intentionally leaves `IndexedName` open-ended.
- Cache successful reverse and owned-name reads for about 15 seconds, matching the API's current cache policy. Do not cache errors for long.
- Treat RNS as optional identity decoration, not an authentication or authorization factor.

The production API is public, read-only, requires no API key, and currently permits browser requests from any origin. A thin app-side adapter is still recommended so Curveball owns validation, fallback behavior, observability, and future provider changes. ([Developer portal](https://developers.stage0.xyz/), [OpenAPI](https://developers.stage0.xyz/openapi.yaml))

## Verified production configuration

| Item | Verified value |
|---|---|
| API base URL | `https://rns.stage0.xyz/v1` |
| API version | `v1` / OpenAPI `1.0.0` |
| Access | Public, anonymous, `GET` and `OPTIONS` only |
| API key | Not required for standard public reads; the OpenAPI document declares `security: []` |
| Network | RISE Mainnet |
| Chain ID | `4153` |
| Native currency | Ether (`ETH`), 18 decimals |
| RPC | `https://rpc.risechain.com` |
| Explorer | `https://explorer.risechain.com` |

Sources: [Stage0 developer portal](https://developers.stage0.xyz/), [Stage0 OpenAPI specification](https://developers.stage0.xyz/openapi.yaml), and the live [`/v1/network`](https://rns.stage0.xyz/v1/network) response.

The live network endpoint currently reports these canonical contracts:

| Contract | Address | Deployment block |
|---|---|---:|
| Registry | `0x6ddca710993c91402d52061868be76043a4c5888` | `20079518` |
| Resolver | `0x36d6383774631565ab0d8f3710748610631a675d` | `20079521` |
| Registrar | `0xbca437a93c2e7396a68ce49be224f65ee3cfd6db` | `20079523` |
| Primary auction | `0x0e37994c19980a792b83a106ce03a9b8a9cd40fc` | `20079526` |
| Marketplace | `0x323a04f474f80225de60c1af13a672796afa6622` | `20079528` |

Do not hardcode these into the basic REST integration. If direct contract reads are added later, verify addresses from [`/v1/network`](https://rns.stage0.xyz/v1/network) during deployment rather than relying on this research snapshot.

## The two endpoints Curveball needs

### `GET /v1/reverse/{address}`

Purpose: choose the primary `.rise` name to display for a wallet.

The path parameter must be a 20-byte EVM address matching `0x` plus 40 hex characters. A successful lookup returns HTTP 200 even when the address has no qualifying name; in that case `primaryName` and the related name fields are `null`. Stage0 first honors a wallet-verified primary-name preference made on Stage0. If no valid preference exists, it falls back to an unexpired owned name that resolves to the address. The preference itself is API metadata, not an onchain reverse record. ([OpenAPI operation](https://developers.stage0.xyz/openapi.yaml), [live empty reverse response](https://rns.stage0.xyz/v1/reverse/0x0000000000000000000000000000000000000000))

Contracted response shape:

```ts
type Stage0ReverseResolution = {
  chainId: 4153;
  address: `0x${string}`;
  primaryName: string | null;
  node?: string | null;
  resolvedAddress?: string | null;
  expiry?: string | null;          // decimal Unix-time-like value; keep as string
  isExpired?: boolean | null;
  lastIndexedBlock?: string | null;
  lastIndexedAt?: string | null;   // observed as ISO 8601 when present
};
```

Only `chainId`, `address`, and `primaryName` are required by the OpenAPI schema. The other properties are optional even though the live service currently emits them. An example wallet in the official docs currently resolves to a response like:

```json
{
  "chainId": 4153,
  "address": "0x78d2e9d2b81d94ed27310d61e5f9e1c4db35fba5",
  "primaryName": "werise.rise",
  "node": "0xa256c0fe97cac4657889981489d4840ce498cc7a5ced350731e9e718fdee74ac",
  "resolvedAddress": "0x78d2e9d2b81d94ed27310d61e5f9e1c4db35fba5",
  "expiry": "1820072349",
  "isExpired": false,
  "lastIndexedBlock": "22220971",
  "lastIndexedAt": "2026-09-19T14:05:30.446Z"
}
```

Source: [live populated reverse response](https://rns.stage0.xyz/v1/reverse/0x78d2e9d2b81d94ed27310d61e5f9e1c4db35fba5).

For display, accept `primaryName` only after checking `chainId === 4153`, `isExpired !== true`, and (when both are present) `resolvedAddress.toLowerCase() === address.toLowerCase()`. The server says it already enforces the latter two rules; the client checks protect against malformed or stale data.

### `GET /v1/addresses/{address}/names`

Purpose: list every active name owned by the wallet. The endpoint includes names under marketplace custody, so `custody` may not always be `wallet`. An address with no active names returns HTTP 200 with `count: 0` and `names: []`. ([OpenAPI operation](https://developers.stage0.xyz/openapi.yaml), [live empty list response](https://rns.stage0.xyz/v1/addresses/0x0000000000000000000000000000000000000000/names))

Contracted top-level response:

```ts
type Stage0AddressNames = {
  chainId: 4153;
  owner: `0x${string}`;
  count: number;
  names: Stage0IndexedName[];
};
```

The current live service emits the following fields per item:

```ts
type ObservedStage0IndexedName = {
  chainId: 4153;
  node: string;
  label: string;
  name: string;
  fqdn: string;
  owner: `0x${string}`;
  registrant: `0x${string}`;
  resolver: `0x${string}` | null;
  resolvedAddress: `0x${string}` | null;
  expiry: string;
  isExpired: boolean;
  registeredTxHash: string;
  registeredAt: string;
  renewedAt: string | null;
  releasedAt: string | null;
  createdAtBlock: string;
  lastIndexedBlock: string;
  lastIndexedAt: string;
  custody: "wallet" | string;
  seller: `0x${string}` | null;
  marketplace: `0x${string}` | null;
};
```

Source: [live populated owned-name response](https://rns.stage0.xyz/v1/addresses/0x78d2e9d2b81d94ed27310d61e5f9e1c4db35fba5/names).

Important stability caveat: in OpenAPI, `IndexedName` is only `type: object` with `additionalProperties: true`; none of the per-item fields above are formally required. Curveball's adapter should therefore extract and validate only the fields it uses—recommended minimum: `name`/`fqdn`, `owner`, `resolvedAddress`, `expiry`, `isExpired`, `custody`, `lastIndexedBlock`, and `lastIndexedAt`—and ignore unknown fields.

## Errors and edge cases

The documented error object has this shape:

```ts
type Stage0Error = {
  error: string;
  detail?: string;
  requestId?: string;
};
```

Observed behavior:

- Invalid EVM address: HTTP 400 with `error: "invalid_address"` and a human-readable `detail`.
- Invalid name: HTTP 400 with `error: "invalid_name"`. The current message says names must be 1–32 characters and contain lowercase letters, numbers, or hyphens.
- Unregistered name on `/resolve` or `/names`: HTTP 404 with `error: "name_not_found"`, plus `chainId` and normalized `name` in the live response.
- No reverse name / no owned names: HTTP 200, not 404.
- Rate limit exceeded: HTTP 429 with an error body and `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers.

Sources: [OpenAPI error responses](https://developers.stage0.xyz/openapi.yaml), [live invalid-address response](https://rns.stage0.xyz/v1/reverse/not-an-address), and a representative [unregistered name response](https://rns.stage0.xyz/v1/resolve/definitely-not-registered-829174.rise).

The live API also returns `X-Request-Id` on responses. The observed 400 and 404 bodies did not contain `requestId`, although the OpenAPI error schema allows it, so log the header first and use the body property only as a fallback.

Client behavior should be:

1. `200` + `primaryName: null` or empty `names`: render the shortened address normally.
2. `400`: treat as a programming/input-validation error and log it.
3. `429`: respect `Retry-After`, stop immediate retries, and render the address fallback.
4. `5xx`, timeout, invalid JSON, or schema mismatch: render the address fallback; RNS failure must not block wallet use.

The public documentation does not define timeout values, retry counts, a formal SLA, or the rate-limit key (for example, per IP versus another dimension). Those remain production uncertainties.

## Rate limits, caching, and freshness

The developer portal states that anonymous clients receive 60 requests per minute by default. Normal live responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`; 429 responses additionally document `Retry-After`. The unit/format of `X-RateLimit-Reset` is not specified in OpenAPI, so Curveball should not assume more than it needs to obey `Retry-After`. ([Developer portal](https://developers.stage0.xyz/), [OpenAPI](https://developers.stage0.xyz/openapi.yaml))

Observed cache policies on 2026-09-19:

| Endpoint family | `Cache-Control` |
|---|---|
| `/resolve`, `/reverse`, `/names`, `/addresses/.../names` | `public, max-age=15, stale-while-revalidate=45` |
| `/network` | `public, max-age=86400, stale-while-revalidate=86400` |
| `/health` | `no-store` |

The docs describe these as short public cache windows but do not promise that the exact durations are immutable. Honor upstream cache headers where possible. If using TanStack Query, a 15-second `staleTime` is a reasonable starting point; avoid automatic refetch loops on 400/404/429.

Freshness indicators differ by data source:

- Onchain responses such as `/resolve` contain `blockNumber` and `source: "onchain"`.
- Indexed responses contain `lastIndexedBlock` and `lastIndexedAt` when available.
- `/health` reports API status, index age, a maximum acceptable index age, mirror-sync age, and each indexer's last processed block/time.

At research time, [`/v1/health`](https://rns.stage0.xyz/v1/health) returned `status: "ok"`, `chainId: 4153`, an index age of 75 seconds, and `maximumAgeSeconds: 900`. These values are a live observation, not a fixed guarantee.

## Browser CORS behavior

Direct browser integration currently works:

- Normal API responses include `Access-Control-Allow-Origin: *`.
- A browser-style `OPTIONS` preflight returned HTTP 204 with `Access-Control-Allow-Origin: *` and `Access-Control-Allow-Methods: GET, OPTIONS`.
- No credentials or authorization header is needed.

This is consistent with the developer portal's public-read positioning. Because CORS policy is represented by response headers rather than the OpenAPI contract, treat it as operational behavior that Stage0 could change. An app-side proxy/adaptor prevents a future CORS change from breaking the UI and provides centralized caching, but it also concentrates requests behind Curveball's server egress and may hit the anonymous limit faster if that limit is IP-based. Stage0 does not document the rate-limit key, so this tradeoff should be load-tested or confirmed with Stage0 before high traffic.

## Suggested Curveball flow

```text
wallet connects / account changes
  -> validate EVM address and RISE chain context
  -> fetch /reverse/{address}
  -> if valid primaryName: show it as the wallet label
  -> otherwise: show shortened address
  -> fetch /addresses/{address}/names only on profile/name-management surfaces
  -> show active names; mark marketplace custody when custody != "wallet"
```

Recommended normalized app model:

```ts
type UserRiseIdentity = {
  address: `0x${string}`;
  displayName: string | null;
  names: Array<{
    name: string;
    custody: string | null;
    resolvedAddress: `0x${string}` | null;
    expiresAt: string | null;
  }>;
  indexedAt: string | null;
};
```

For a header/avatar label, call only `/reverse`; it already implements Stage0's verified-primary preference and fallback. Fetching the full list on every page is unnecessary and consumes the 60 rpm anonymous budget. For a profile or name picker, fetch both endpoints and order the list with `primaryName` first if it appears in `names`.

Do not use an RNS name as proof that the current visitor controls an address. Wallet signature/session verification remains the source of authentication. Likewise, before sending funds to a typed `.rise` destination, call `/resolve/{name}` and validate `chainId`, `address`, and expiry at the time of the action rather than trusting a previously displayed reverse name.

## Setup and production deployment checklist

There is no Stage0 account, API-key provisioning step, SDK installation, or secret environment variable documented for v1 public reads.

1. Add an app configuration value such as `STAGE0_RNS_BASE_URL=https://rns.stage0.xyz/v1`; keeping the URL configurable makes testing and provider changes safer.
2. Implement one typed RNS client/adaptor with address validation, an abort timeout, response-status handling, and runtime response validation.
3. Use `/reverse` for global wallet-display surfaces and lazy-load `/addresses/{address}/names` only where the complete list is useful.
4. Match or honor the 15-second public cache window. Coalesce duplicate queries for the same lowercase address.
5. Render a shortened address on every failure path. Never make login, transactions, or navigation depend on Stage0 availability.
6. Log HTTP status and `X-Request-Id`, but do not treat public wallet addresses as secret data.
7. Add production monitoring against `/health` with caching disabled. Alert when the status is not `ok`, chain ID is not 4153, or `index.ageSeconds > index.maximumAgeSeconds`.
8. Verify `/network` during deployment and record the chain ID and canonical contracts in deployment logs if direct onchain fallback is enabled.
9. Load-test within the anonymous 60 rpm limit. Ask Stage0 about higher-volume access before launch if projected uncached traffic can exceed it; no higher-tier process is published in the developer docs.
10. Smoke-test production from the actual deployed origin: a wallet with a preferred name, a wallet with multiple names, a wallet with no names, a malformed address, and a simulated 429/upstream outage.

Suggested deploy gates:

```sh
curl --fail https://rns.stage0.xyz/v1/health
curl --fail https://rns.stage0.xyz/v1/network
curl --fail https://rns.stage0.xyz/v1/reverse/0x0000000000000000000000000000000000000000
```

The first two checks verify service/indexer health and network identity. The third verifies the reverse endpoint's valid empty-state contract.

## SDKs and examples

No dedicated Stage0 JavaScript/TypeScript SDK or package is linked from the developer portal or OpenAPI specification. The official examples use:

- native `fetch` for REST resolution;
- TanStack Query for a React component;
- Viem plus `namehash` from `viem/ens` for direct registry reads;
- a RISE public client pointed at `https://rpc.risechain.com` for onchain access.

The portal's direct-read example reads `owner(bytes32)` from the registry. This is useful as an independence/fallback path, but it does not reproduce indexed reverse-primary preferences or the address-owned-name discovery endpoint. For Curveball's stated requirement, REST should be the primary implementation. ([Official examples](https://developers.stage0.xyz/))

The broader product documentation describes `.rise` as the RISE identity layer intended for display across dApps and explorers, and specifically says names may identify wallets and receive assets. ([RISE Names product documentation](https://stage0-labs.gitbook.io/docs/core-products/rise-names))

## Terms and remaining production uncertainties

The API's OpenAPI metadata labels its license `Proprietary` (`LicenseRef-Stage0-Proprietary`). The general Stage0 Terms say use is subject to applicable laws, is at the user's own risk, may involve third-party services, and that Stage0 may change the terms. They do not publish an API-specific SLA, uptime commitment, data-retention policy, attribution requirement, redistribution permission, commercial API terms, or guaranteed backwards-compatibility period beyond calling v1 responses stable. ([OpenAPI license metadata](https://developers.stage0.xyz/openapi.yaml), [Stage0 Terms of Service](https://stage0-labs.gitbook.io/docs/resources/terms-of-service))

Before a high-traffic production launch, obtain written clarification from Stage0 on:

- whether commercial dApp use and server-side caching/redistribution are permitted under the proprietary API license;
- whether 60 rpm is per IP, origin, or another key, and how to request higher limits;
- support/escalation contacts and service expectations;
- version-deprecation notice periods;
- whether the currently observed `IndexedName` fields will become a contracted schema;
- expected maximum indexing lag and incident behavior;
- whether wallet addresses/request logs are retained and for how long.

These are documentation gaps, not evidence that production use is forbidden. The published portal explicitly invites ecosystem applications to integrate RISE Names, exposes a no-key public API, and calls v1 responses stable, but the proprietary license makes confirmation prudent. ([Developer portal](https://developers.stage0.xyz/), [RISE Names documentation](https://stage0-labs.gitbook.io/docs/core-products/rise-names))

## Primary sources

- [Stage0 RNS developer portal](https://developers.stage0.xyz/)
- [Stage0 RNS OpenAPI 3.1 specification](https://developers.stage0.xyz/openapi.yaml)
- [Live RNS network configuration](https://rns.stage0.xyz/v1/network)
- [Live RNS health and index freshness](https://rns.stage0.xyz/v1/health)
- [Stage0 RISE Names product documentation](https://stage0-labs.gitbook.io/docs/core-products/rise-names)
- [Stage0 Terms of Service](https://stage0-labs.gitbook.io/docs/resources/terms-of-service)
