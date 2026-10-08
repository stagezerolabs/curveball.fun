# Curveball UI rebuild prototype

## Design contract

Keep Curveball's dark ink, lime action, orange market movement, and editorial serif accent. Use compact, readable market surfaces rather than equal-sized marketing cards. The product is a token discovery and trading app; prices, status, liquidity, and actions must be legible before decoration.

Radix Themes owns the visual tokens and styled controls. Base UI owns interaction behavior for tabs, selects, menus, and dialogs. Lightweight Charts owns market time series. Preserve the existing wallet, routing, contract, and market data behavior.

## Screen map

```text
Global: brand | market search | Markets | Create | theme | wallet

Landing: statement + illustrative curve | live product explanation | launch path
Explore: featured market | Trending / New / Graduated | sort + view | market cards
Markets: page heading | market filter | dense market list
Market: token identity + key metrics | candle/volume chart | trade | milestones | chain facts
Launch: identity -> launch settings -> transaction progress dialog
Profile: wallet summary | launched markets | empty state
```

## Interaction and responsive rules

- Base UI tabs keep filter state keyboard accessible. Filtering also has a visible empty state.
- Base UI select handles sort and tax options; the launch form still submits the selected tax value.
- Base UI dialog handles transaction progress and focus. Pending stages cannot be dismissed; success and error can.
- Radix Themes provides the app theme, inputs, buttons, badges, and panels. A small Curveball token layer sets brand colors and spacing.
- At 320–767px, navigation collapses, market actions stack below the chart, and dense rows allow horizontal-safe content wrapping.
- At 768–1023px, the market has one main column. At 1024px and above, chart and trade actions share a two-column workspace.
- Loading, error, empty, disconnected-wallet, unavailable-chart, and graduated-market states retain useful copy and actions.

## Prototype hierarchy

```text
MARKET                                   [live status]
Token name / $SYMBOL       price 24h     progress
--------------------------------------------------
Price chart               | Buy / Sell
1m 5m 15m 1h 4h 1d        | amount + balance
candles + volume          | quote + submit
                          | graduation + fees
--------------------------------------------------
On-chain details: token / curve / creator / pool
```

The top bar, action treatment, text scale, and panel borders repeat across every route. Avoid faux market statistics or invented chart points; show a clear empty state when live data is absent.
