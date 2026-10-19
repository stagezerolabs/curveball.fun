# Pulse on live data

Date: 2026-10-19
Branch: `feature/pulse-signal-desk` (PR #75)

## Goal

Replace the mock data on all three Pulse tabs (Now, Following, Leaderboard) with real trades, and
present each tab as compact ranked rows that share one visual language.

## Shared decisions

- **Data source:** the social API when `VITE_SOCIAL_API_URL` is set. Now and Following fall back
  to computing the same result in the browser from on-chain `Trade` logs; the Leaderboard has no
  on-chain fallback.
- **No time controls:** no 1h/24h toggle, no relative timestamps on cards, no "observed" spans.
- **Trade value** is the event's `quoteAmount`: what the trader paid on a buy (fee and tax
  included) or received on a sell. This equals the backend's `trades.net_trader_quote`.
- **Row layout:** every tab renders one compact card per item: identity on the left, supporting
  detail in the middle, one headline figure on the right. Where a card is a market, the whole
  card links to the market page.
- **Trader avatars** are dicebear "thumbs" seeded by wallet address (`TraderAvatar`), shared with
  profile pages, falling back to initials.

## Now

Markets being bought into.

- **Filter:** buy value > sell value over the last 24 hours (fixed window, not user-selectable).
- **Ranking:** net inflow (buy − sell) descending, tie-break by latest trade; at most 12.
- **Card (`PulseNowCard`):** token image, name, `$SYM · MC · NN% to graduation` (graduation hidden
  once graduated); a green/red split bar of buy vs sell value with "x bought" / "y sold";
  headline `+x WETH` labelled "net inflow".
- **Backend:** `nowPulseSql` — one row per market over `[asOf − 24h, asOf]`, excluding orphaned
  trades, non-user-attributable protocol accounts and viewer-blocked wallets,
  `HAVING buy > sell ORDER BY net DESC, latest_at DESC LIMIT 12`. Served by
  `GET /v1/pulse?scope=now&period=24h`.
- **On-chain fallback:** `buildNowMoments` (`src/social/nowPulse.ts`) over the shared trade-sample
  cache in `src/lib/marketPreviewStats.ts`, which now records `isBuy` and `quoteWei` per trade.
- **Empty state:** "No markets are being bought into right now."

## Following

Markets bought by wallets you follow.

- **Who counts:** wallets the signed-in viewer follows. Follows are not fully live yet, so when the
  viewer is signed out or follows nobody, every user wallet counts.
- **Grouping:** one row per market with each buyer and their total buy spend; ordered by number of
  buyers, then total spend; at most 12. Sells are ignored.
- **Card (`PulseFollowingCard`):** token image, name, `$SYM · MC`; an avatar stack of up to three
  buyers with "Name, Name +N" and "N follows bought"; headline total `x WETH` "bought by follows".
- **Backend:** `followingBuysSql`, served by `GET /v1/following/buys` →
  `{ scope: "following" | "all", items: FollowingBuy[] }`. Excludes protocol accounts and
  viewer-blocked wallets.
- **On-chain fallback:** `buildFollowingBuys` (`src/social/followingBuys.ts`), every wallet,
  buyers shown by short address.

## Leaderboard

- **Source:** the latest published snapshot when it uses the current method
  (`curve-known-basis-v2`) and has eligible traders. Otherwise the API returns a **provisional**
  board (`provisional: true`): every trader's latest `trader_performance_snapshots` row with at
  least one trade, ranked by `return_bps` descending. The provisional board is not filtered by
  profile discoverability (owner decision).
- **Row (`PulseTraders`):** rank (top three in lime), trader avatar, name and short address,
  headline est. return. No stats block, search, sort, cards/rows switch or "Qualified" tag.
- **Toolbar:** a single icon refresh button (the shared `market-refresh` style, spins while
  loading). The Track record / Emerging switch is removed; the board is Track record.
- **Footnote:** "How ranks are calculated", noting when the board is provisional.

## Related polish in the same PR

- Pulse and Explore pages: top padding reduced to 8px so the page title / first section sits
  just under the navigation.
- Profile → Launches: market cap and launch age folded into the token header line; the two
  fact boxes and the token explorer link are removed; "View market" keeps no hover colour change.

## Removed

- `src/social/mockPulse.ts` and its test; `PulseMomentCard` and its styles.

## Testing

- `nowPulse.test.ts`: window edges, net > 0 filter, ranking and tie-break, cap, unknown tokens,
  latest-buy sample hash, distinct wallets.
- `followingBuys.test.ts`: grouping, ordering by buyer count, followed-wallet narrowing.
- `PulseNowCard.test.tsx`: card content and graduated markets.
- `pulse.test.mjs`: `nowPulseSql` filter and ordering.
- All three backend queries were run read-only against the stack database before wiring.
- Visual checks of each tab in the Docker preview (`make docker-frontend`, API rebuilt with
  `make docker-build-service SERVICE=api` + `make docker-recreate-service SERVICE=api`).
