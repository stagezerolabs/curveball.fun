# Launch and market states

The active V1 factory opens launch creation to any connected wallet after initialization. `src/lib/marketState.ts` still supports invited-beta state for historical factories, but the active V1 factory reports `publicLaunchOpen() == true` and `invited(address) == false`. The UI reads those methods in the launch and trade flows.

| Market state | Buy on curve | Sell on curve | Display |
| --- | --- | --- | --- |
| Bonding (`sold < curveSupply`) | Available to an eligible connected wallet | Available to a holder | Live / On the curve |
| Bonding complete (`sold == curveSupply`, pool not confirmed) | Disabled | Available; a sale can reopen the curve | Bonding complete; pool preparation is automatic |
| Graduated (`graduated == true`) | Unavailable on curve | Unavailable on curve | Graduated; explorer link to the confirmed pool address |

The backend keeper handles V1 graduation in two transactions: `graduate(token)` marks a sold-out curve ready, then `createGraduatedPool(token)` creates the venue pool. Users do not sign these calls. Until the second transaction confirms, the UI keeps the market out of the Live category and shows Bonding complete. The current venue is a mock: its pool has an address and locked LP tokens but no swaps. For a future real Icarus venue, the trade panel links to the Icarus app after graduation.

The pool link uses the curve's nonzero `pool()` address after `graduated()` is true. `src/creatorTokens.ts` derives the market status from on-chain sold, ready, and graduated state; `src/pages/MarketPage.tsx` polls while awaiting graduation so an open page updates after confirmation.
