# Beta and market states

The shipped interface uses these states to select launch and trade availability. The pure selector in `src/lib/marketState.ts` supplies the beta and market decisions used by `src/pages/LaunchPage.tsx` and `src/components/TradePanel.tsx`. `src/components/MarketHeader.tsx` and `src/components/MilestonePanel.tsx` display the corresponding curve and graduation status labels.

| State | Launch form | Trade panel | Market header / milestone |
| --- | --- | --- | --- |
| Invited beta | Enabled for invited wallet | Buy and sell enabled | “On the curve” |
| Uninvited beta | Disabled, invitation required | Buy disabled; sell enabled for holders | “On the curve” |
| Ready, graduation deferred | Creation unaffected | Buy disabled; sell remains enabled | “Graduation pending”; explain pool creation can be retried by anyone after upstream recovers |
| Graduated | Creation unaffected | Curve trade replaced by Icarus app link | Verified pool explorer link; “basic volatile CURVE/WETH pool”; no gauge or emissions claim |
| Public | Creation enabled for any wallet | Buy and sell enabled | Standard curve status |

The pool address comes from the `Graduated` event or live `markets(token)` state. An empty pool address never creates a link. External swap navigation goes to the official Icarus app home because its route scheme is not part of the published integration contract; users must check the token address in the app.
