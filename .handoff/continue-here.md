# Curveball handoff — wrapping complete, USD conversion in progress

Paused: 2026-09-19 23:11 WAT  
Branch: `main`  
State: dirty working tree; nothing committed or deployed

## Resume here

Read this file, then run:

```sh
git status --short
bun test
bun run typecheck
bun run build
```

The last command group was **not** run after the final batch of USD UI edits. Typecheck was run after those edits and passed. Continue the USD work test-first; do not revert unrelated untracked files.

## User goal and agreed order

The user asked to fix the production issues step by step:

1. Native ETH → WETH wrapping and balance guard
2. Dynamic USD token prices and market caps
3. Stage0 RNS names for connected wallets

Step 1 is implemented and verified. Step 2 is partially implemented. Step 3 has research only and no application code.

## Completed: ETH → WETH wrapping and balance guard

Production diagnosis:

- The deployed Curveball quote token is canonical RISE WETH at `0x4200000000000000000000000000000000000006`.
- The production creator wallet had native ETH but zero WETH.
- The frontend approved WETH and then called `buyTokens`; it did not verify WETH balance or wrap native ETH.
- A live read-only `buyTokens` simulation reproduced `execution reverted`.
- The market itself was active, not pending, and not graduated.

Implemented behavior:

- `CurveballSdk.trade("buy", ...)` reads WETH balance.
- If WETH is short, it wraps only the shortfall via WETH `deposit()`.
- It reserves `0.00001 ETH` for gas and rejects before any write if native ETH is insufficient.
- Transaction order is: wrap → approve if needed → fresh quote → `buyTokens`.
- Sell trades also reject early when token balance is insufficient.
- `ConfirmedTrade` reports `wrappedAmount`.
- The trade panel shows available WETH, previews the exact wrap amount, blocks underfunded buys, and includes spendable native ETH in percentage presets.
- Token balances refresh every five seconds.

Relevant files:

- `src/sdk/wagmiSdk.ts`
- `src/sdk/contracts.ts`
- `src/sdk/react.ts`
- `src/components/TradeFundingStatus.tsx`
- `src/components/TradePanel.tsx`
- `src/style.css`
- `src/sdk/wagmiSdk.trade.test.ts`
- `src/components/TradeFundingStatus.test.tsx`
- `src/sdk/wagmiSdk.integration.test.ts`

Verification already completed:

- Full suite after wrapping: `19 passed`, `3 skipped`, `0 failed`.
- Typecheck passed.
- Production build passed.
- End-to-end SDK integration passed on an ephemeral RISE mainnet fork: create → wrap → approve → buy.
- Live RISE WETH wrapping estimate: `45,312` gas at `415,300` wei gas price; the reserve is comfortably above observed transaction cost.
- The temporary Anvil process was stopped. No mainnet transaction was sent.

## In progress: dynamic USD price and market-cap display

### Completed backend/domain slices

`src/ethUsd.ts` now contains:

- CoinGecko `/simple/price` source for Ethereum/USD.
- Optional `COINGECKO_API_KEY`, sent only from the server as `x-cg-demo-api-key`.
- Five-second upstream timeout.
- Runtime validation of USD value and timestamp.
- Shared 30-second in-memory cache.
- Last-known-rate fallback marked `stale: true` for up to ten minutes.

`src/usdValuation.ts` adds USD fields without overwriting WETH-native trading fields:

- `priceUsd`
- `marketCapUsd`
- `peakMarketCapUsd`
- `ethUsd`
- `usdUpdatedAt`
- `usdStale`

`src/server.ts` now obtains one shared ETH/USD snapshot while enriching `/api/tokens` and calls `addUsdValuation(...)`. Provider failure is best-effort and results in null USD fields rather than breaking `/tokens`.

Tests already green:

- `src/ethUsd.test.ts`: 3 passing tests
- `src/usdValuation.test.ts`: 1 passing test
- `src/lib/format.test.js`: 1 passing test
- `src/components/TokenCard.test.tsx`: 1 passing test

`src/lib/format.js` now exports:

- `formatUsd` for small token prices with significant digits
- `formatUsdCompact` for valuations such as `$26.38K`

`src/types.ts` includes the additive USD token fields. WETH fields must remain because price-impact calculations and contract calls use WETH units.

### USD UI edits already applied

These components have been changed to use USD price/market-cap fields:

- `src/components/TokenCard.tsx`
- `src/components/MarketList.tsx`
- `src/components/MarketHeader.tsx`
- `src/components/NavSearch.tsx`
- `src/components/MilestonePanel.tsx`
- `src/components/TradePanel.tsx` (displayed spot price only; price-impact math still uses native `token.price`)
- `src/components/Featured.tsx`
- `src/components/PriceChart.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/MarketsPage.tsx`

Sorting now uses `marketCapUsd` where edited.

Current typecheck passes after these edits. `git diff --check` passes.

### USD work still required

1. Run the full suite and production build immediately. The latest UI batch has only been typechecked.
2. Review `src/components/Featured.tsx` and `src/components/PriceChart.tsx` visually and add/adjust rendered-output tests where useful.
3. Finish price display conversion in `src/components/MarketTabs.tsx`:
   - Per-trade price column should use `quote / amount * token.ethUsd` and USD formatting.
   - Account current value and average cost are price surfaces and should use USD.
   - Preserve token quantities and WETH transaction amounts.
   - Decide explicitly whether total spent/received remain WETH (recommended for accounting accuracy) or show an approximate current-rate USD conversion.
4. Add dynamic token refresh. `src/app/App.tsx` still fetches tokens only once and after local actions. Recommended behavior:
   - Poll current token data every 15 seconds.
   - Refresh immediately when the tab becomes visible.
   - Prevent overlapping requests.
   - Keep immediate refresh after create/trade.
5. Surface rate freshness unobtrusively when `usdStale === true`; do not block trading.
6. Add `COINGECKO_API_KEY` to `docs/koyeb-production.md` as an optional/recommended Koyeb secret. No frontend `VITE_` key.
7. Confirm `/api/tokens` live response contains populated USD fields in an environment with outbound network access.
8. Re-run full tests, typecheck, build, and `git diff --check`.

### Important USD decisions/caveats

- Never replace `token.price` with USD. It is WETH/token and is required by trade price-impact math.
- The current `marketCap` calculation is spot price × full fixed supply. Economically this is closer to FDV, although the UI still calls it “Market cap.” No rename has been made.
- `PriceChart.tsx` currently converts historical WETH candles using the **current** ETH/USD snapshot. This is a spot conversion, not historically exact FX. Before calling the chart production-complete, either:
  - label it as using the current ETH/USD rate, or
  - persist historical ETH/USD snapshots and align them with candle timestamps.
- Volume and liquidity still display in ETH in several places. The user specifically asked for prices and market caps in USD; do not silently convert historical volume using the current rate without deciding that approximation explicitly.

## Stage0 RNS status

Research is complete in `docs/stage0-rns-research.md`. No RNS application code has been added yet.

Recommended later implementation:

- `GET https://rns.stage0.xyz/v1/reverse/{address}` for the primary wallet label.
- Lazy-load `/v1/addresses/{address}/names` for all owned names.
- Cache about 15 seconds and fall back to shortened address.
- Treat RNS as display-only, never authentication or authorization.

## Working-tree safety

Known unrelated/user-owned untracked paths existed before this work and must not be removed or overwritten:

- `deployments.local-backup/`
- `neon.ts`

Created during this work:

- `docs/stage0-rns-research.md`
- wrapping tests/components listed above
- USD provider, valuation, formatter, and tests listed above

No commit and no deployment have been made.

## Suggested next test-first slice

Start with the rendered MarketTabs price seam:

1. Add a failing test proving a known trade price renders in USD while its WETH amount remains WETH.
2. Implement only that conversion.
3. Then add the dynamic-refresh seam for `/api/tokens` and implement polling without overlapping requests.

