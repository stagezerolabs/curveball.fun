# Pulse "Now" on live data

Date: 2026-10-19
Branch: `feature/pulse-signal-desk`

## Goal

The Pulse **Now** tab currently renders hard-coded examples from
`src/social/mockPulse.ts`. Replace them with real trade data so Now highlights
the markets that are being bought into over the selected window (1h / 24h).

## Decisions

- **Data source:** backend first, RPC fallback. Use `GET /v1/pulse` when
  `VITE_SOCIAL_API_URL` is set; otherwise compute the same result in the
  browser from on-chain `Trade` logs. Production has no social API today, so
  the RPC path is what ships live.
- **Filter:** net buying only. A market appears only if buy value exceeds sell
  value inside the window. No net-selling or balanced cards.
- **Ranking:** net quote inflow (buy − sell) descending, tie-break by latest
  trade time descending. Cap at 12 markets.
- **Window semantics:** one aggregate per market over `[now − period, now]`.
  Both sources mean the same thing by "+12.8 WETH".
- **Card:** the mock's layout plus real market context (image, market cap,
  curve progress). Example/illustrative scaffolding is removed.

## Definitions

- Trade value is the event's `quoteAmount`: what the trader paid on a buy (fee
  and tax included) or received on a sell. This equals the backend's
  `trades.net_trader_quote`.
- `buyQuoteWei` = sum of trade value over buys in the window; `sellQuoteWei`
  likewise for sells; `netQuoteWei` = buy − sell.
- `distinctWalletCount` = distinct `trader` addresses in the window.
- `firstAt` / `latestAt` = earliest / latest trade timestamp in the window.
- `sampleTransactionHash` = hash of the most recent buy in the window.

## Architecture

### Shared aggregator — `src/social/nowPulse.ts`

Pure function, no I/O:

```ts
buildNowMoments(trades: PulseTrade[], tokens: Token[], period: PulsePeriod, now: number): PulseMoment[]
```

- `PulseTrade` = `{ token, trader, isBuy, quoteWei: bigint, timestamp, transactionHash }`.
- Drops trades outside the window and trades for tokens not in `tokens`
  (name/symbol come from the token list).
- Groups by token, keeps `net > 0`, ranks and caps as above.
- Returns `PulseMoment` with `reason: "net_buying"`, `followedTraderCount: 0`.

### RPC path — extend `src/lib/marketPreviewStats.ts`

- Extend `MarketTradeSample` with `isBuy: boolean` and `quoteWei: bigint`
  (from the `Trade` log args already fetched). The existing incremental
  `tradeSampleCache` is reused, so Pulse and the markets list share one fetch.
- Export a loader that returns the cached samples (refreshing incrementally
  from the last cached block) so the Pulse hook can feed `buildNowMoments`.

### Backend path — `services/social`

- New `nowPulseSql` in `src/pulseSql.mjs`: one row per market over
  `[$asOf − period, $asOf]`, same exclusions as today (orphaned trades,
  non-user-attributable protocol accounts, viewer-blocked wallets),
  `HAVING buy > sell`, `ORDER BY buy − sell DESC, latest_at DESC LIMIT 12`.
  `transaction_hash` = most recent buy.
- `scope=now` uses `nowPulseSql`; `scope=following` keeps its existing SQL.
- `shapePublicPulseMoments` stays the response shaper.

### Hook — `src/social/useNowPulse.ts`

`useNowPulse(period)` returns a React Query result of `PulseMoment[]`:

- If `socialApiConfigured`: `socialApi.pulse("now", period)`, then filter
  `net > 0` defensively.
- Else: load samples via the RPC loader and run `buildNowMoments` with the
  store's `tokens` (calling `loadMarkets` if the store is empty, as
  `MarketsPage` does).
- `refetchInterval` ~15s, `staleTime` 15s, `retry: 1`.

The page joins each moment to the store's `Token` by address for image,
market cap, progress and graduation state. On the backend path a moment whose
token is not in the store still renders, just without that context.

## UI

`PulseMomentCard` (live mode):

- Topline: `Net buying` pill, relative time of `latestAt`.
- Token block: token image (letter avatar fallback), name, `$SYM · MC x WETH`.
- Curve progress bar with `NN% to graduation`; hidden when graduated
  (consistent with recent milestone-panel commits).
- Headline: `+x WETH` labelled `net inflow`.
- Facts row: Trades (buy / sell), Buy / Sell WETH, Wallets.
- Footer: `Active a–b ago`, `Sample transaction ↗`, `View market →`.
- Whole card navigates to the market; inner links still work.
- Removed in live mode: the "Why shown" line, the Example tag and the
  "Illustrative data" note. The `preview` mode stays for the Following tab.

`SocialPage` Now panel:

- Loading: existing `LoadingState` skeleton.
- Error: `FeedState` with retry.
- Empty: "No markets are being bought into in the last 1h." On 1h, offer a
  button to switch to 24h.
- Remove the `pulse-context` disclaimer under Now.

## Out of scope

- Following tab stays on mock data.
- Leaderboard unchanged.
- RPC path cannot exclude protocol accounts (that list lives in the backend
  DB); accepted divergence.

## Testing

- `nowPulse.test.ts`: window edges, net > 0 filter, sell-only and balanced
  markets excluded, ranking and tie-break, cap of 12, unknown tokens dropped,
  sample hash is latest buy, distinct wallets.
- `marketPreviewStats` tests updated for the new sample fields.
- `pulse.test.mjs`: `nowPulseSql` filters and orders as specified.
- Component test: card renders live fields, hides progress when graduated;
  page shows loading / error / empty states.
- Browser check of `/pulse` on the RPC path and against the local backend.
