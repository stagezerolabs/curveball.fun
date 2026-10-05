# Curveball handoff — superseded

This file described the USD/wrapping/RNS work in progress as of 2026-09-19. It is
superseded by the V2 cutover that has since landed:

- ETH → WETH wrapping and the balance guard: shipped in `src/sdk/wagmiSdk.ts` and the trade panel (V1 surface).
- Dynamic USD prices and market caps: shipped — `src/ethUsd.ts`, `src/usdValuation.ts`, server and Worker enrichment, UI conversions in `TokenCard`, `Featured`, `MarketHeader`, `TradePanel`, `MilestonePanel`, `NavSearch`, `PriceChart`. The ETH-rate staleness marker renders in `MarketHeader` when `usdStale` is true.
- `MarketTabs` per-trade/account USD conversion: superseded by decision. The V2 cutover removed the holders and account tabs because the V2 indexer does not provide wallet holdings (the API returns `501` for those endpoints); the trades tab intentionally keeps WETH amounts for accounting accuracy.
- Periodic token refresh: shipped in `src/app/App.tsx` — 15-second poll, refresh on tab visibility, overlap guard; store actions still refresh immediately after create, trade, and graduation.
- `COINGECKO_API_KEY`: documented as an optional Koyeb secret in `docs/koyeb-production.md`.
- Stage0 RNS names: still research only (`docs/stage0-rns-research.md`); no application code exists yet.

Current authoritative state: `docs/runbooks/curveball-v2-testnet.md` (V2 cutover),
`docs/runbooks/local-v2-testnet.md` (local V2 stack), and
`docs/local-first-mainnet.md` (mainnet preparation).
