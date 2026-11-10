# ETH-funded market launch and initial buy

## Current behavior

The deployed `CurveLaunchpad.launch()` accepts WETH for both the launch fee and an optional first buy. It cannot receive native ETH. The frontend SDK already reads the wallet's WETH balance, wraps any shortfall from ETH, approves the launchpad when needed, then submits one `launch()` call. These are separate wallet transactions when wrapping and approval are needed (`src/sdk/sdk.ts`, `ensureApproval()` and `launch()`). A fee-only launch can therefore start from an ETH-only wallet that has enough ETH for the fee and gas.

The launch form blocks the intended first-buy path. Its None/25%/50%/Max presets use `initialBuyFromWethBalance()` and disable every nonzero choice when WETH is zero (`src/pages/LaunchPage.tsx`, `src/lib/launchForm.ts`). An ETH-only wallet can pay the fee through wrapping but cannot select an initial buy. The existing SDK test proves `deposit → approve → launch` works for a first buy; a local check of the form helper with zero WETH and enough ETH returned zero and reproduced the UI restriction.

## Intended experience

- Let a wallet launch with ETH alone, WETH alone, or both. Keep **None** as the default first buy.
- Show the first-buy budget as an ETH-equivalent amount, with the existing percentage presets based on combined spendable ETH and WETH. Reserve the launch fee and ETH for gas before calculating Max. An explicit amount field should let the creator choose a smaller first buy.
- In the review, show the fee, first buy, total WETH charged by the contract, existing WETH used, ETH to wrap, and the gas reserve. Say that wrapping, approval, and launch can require separate confirmations.
- If wrapping succeeds but a later step is rejected, leave the resulting WETH in the wallet and let retry reuse it. Do not imply a market exists until the `launch()` receipt succeeds.

## Implementation steps

1. Add the native ETH balance to `LaunchPage` with `useBalance`. Replace the WETH-only preset calculation with one shared funding helper: `spendable = WETH + max(ETH − gas reserve, 0)`; `first-buy budget = max(spendable − launch fee, 0)`. Keep the chosen amount in integer wei. Share reserve and rounding rules with the SDK, check gas funding even when WETH covers the purchase, and disable or explain choices that cannot fund the fee plus buy. Validate that the reserve covers wrap, approval, and launch gas before offering Max.
2. Add an ETH-equivalent amount input and make None/25%/50%/Max fill it. Show clear loading and balance-read errors. Lock the reviewed wei amount at confirmation so balance polling cannot silently change the submitted first buy.
3. Reuse the SDK's existing wrap-and-approve path. At submission, re-read balances and allowance; wrap only the shortfall for `launch fee + first buy`, then call `launch()` with that exact WETH first-buy amount and its minimum token output. No contract redeployment is needed.
4. Update the launch review and the website's Launching docs to explain the funding split and multiple wallet prompts. Keep USD figures as estimates; settlement remains in WETH.

## Verification

Add funding-helper tests for ETH-only, WETH-only, mixed balances, fee-only launch, Max with gas reserve, insufficient gas, and amounts too small to produce a valid first-buy quote. Keep the existing SDK test that confirms an ETH-only first buy wraps exactly the fee plus buy; add mixed-balance and retry cases. Check that a rejected approval or launch never triggers a duplicate launch on retry. Exercise the form in the local Docker app with an ETH-only wallet and confirm the displayed review matches the wallet prompts; use a fork or test environment for transaction tests rather than spending mainnet funds.

## Implementation status

The launch form now budgets ETH and WETH together, reserves 0.00003 ETH for up to three wallet transactions, and limits Max to the opening wallet cap. Its review lists the wrap, approval, and launch steps. The SDK's existing wrap-and-approve sequence is unchanged; a retry test confirms it reuses WETH after an approval rejection. The website's Launching chapter and FAQ explain the flow. TypeScript, 191 Bun tests, the production build, and the local mainnet Docker image passed. The Docker API returned HTTP 200 for health, launch, and docs routes. An actual wallet confirmation sequence still needs an ETH-funded wallet in a test or fork environment.
