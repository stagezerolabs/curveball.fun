# Token-funded curve buys: pivot note

Status: design note, 2026-10-08. No contract change or testnet deployment is authorized by this note.

## Product intent

A user holding an accepted ERC-20, starting with a mock six-decimal USDC on RISE Testnet, should be able to buy a Curveball launch token without first acquiring WETH manually. The buy screen should let the user choose the payment asset, enter its amount, see the estimated launch tokens and both sources of slippage, and submit one atomic swap-and-buy transaction after any required token approval. The user still needs native ETH for transaction gas unless a separate sponsorship feature is designed.

For the first release, this is **one WETH-denominated curve with multiple payment inputs**. It is not a separate curve or reserve for each payment asset. Selling and graduation continue to settle in WETH. An output-asset choice for sellers is a later feature.

## What exists today

- The deployed V2 factory has one immutable `quote`, the canonical testnet WETH at `0x4200000000000000000000000000000000000006`; its curve stores real and virtual quote balances in that asset. See [`CurveLaunchFactory.sol`](../../contracts/contracts/CurveLaunchFactory.sol), [`CurveBondingCurve.sol`](../../contracts/contracts/CurveBondingCurve.sol), and the [deployment record](../../deployments/11155931/curveball-v2.json).
- `buyTokens` takes WETH from the buyer. `buyTokensFor` accepts another payer but only when called by the factory's configured `launchAndBuy` wrapper. A new adapter cannot buy on behalf of a user from existing curves without changing that authorization boundary; the current factory's wrapper is initialized once. See [`CurveBondingCurve.sol`](../../contracts/contracts/CurveBondingCurve.sol) and [`CurveLaunchFactory.sol`](../../contracts/contracts/CurveLaunchFactory.sol).
- The frontend buy path currently checks WETH and native balance, wraps ETH if necessary, approves the curve, quotes in WETH, then calls `buyTokens`. Its input and balance display assume the quote token has 18 decimals. See [`v2Sdk.ts`](../../src/sdk/v2Sdk.ts), [`TradePanel.tsx`](../../src/components/TradePanel.tsx), and [`useStore.js`](../../src/app/useStore.js).
- Graduation creates a launch-token/WETH pool and the fee escrow and buyback vault account in WETH. Changing the curve's quote asset would cascade into graduation and fee policy. See [`CurveGraduationExecutor.sol`](../../contracts/contracts/CurveGraduationExecutor.sol), [`CurveFeeEscrow.sol`](../../contracts/contracts/CurveFeeEscrow.sol), and [`CurveBuybackVault.sol`](../../contracts/contracts/CurveBuybackVault.sol).

## Recommended transaction design

Curveball is currently a direct-to-chain Vite app, with no transactional backend. A future backend may discover supported assets, request swap quotes, and return route calldata; the client could also do this directly if the selected venue supports it. **No backend should receive custody or hold a signing key.** The connected wallet approves a narrowly scoped on-chain adapter and signs the final transaction. The adapter executes the swap and curve buy atomically; if the swap, minimum WETH, or minimum launch-token output fails, the whole transaction reverts.

```text
User wallet --input ERC-20--> swap-and-buy adapter
Adapter --input ERC-20--> allowlisted swap venue
Swap venue --WETH--> adapter --WETH--> Curveball curve
Curve --launch tokens--> user wallet
Adapter --unused input/WETH--> user wallet
```

Proposed adapter call: `buyWithToken(curve, inputToken, maxInput, minWethOut, minLaunchTokensOut, deadline, routeData)`. The exact interface and route encoding need a spec before implementation. The adapter should verify that `curve` belongs to the chosen factory, `inputToken` and swap venue are allowlisted, the route outputs the factory's WETH, and the recipient is the original wallet. It must use actual balance deltas for input received and WETH output, cap input spending, use a deadline, constrain approvals, refund unused balances to the caller, and never use a user-supplied arbitrary call target. The curve should authorize the adapter as a delegated payer while preserving the existing direct WETH buy and launch-and-buy paths. The factory should govern the adapter/venue allowlist with explicit events and an emergency disable path.

The **backend quote is advisory**. The adapter enforces `minWethOut`; the curve enforces `minLaunchTokensOut` and its own deadline. Display swap price impact, route fee, curve price impact, curve fee and creator tax separately. A route can become stale between quote and execution, so the user must see a refresh/error state and the app must never silently widen slippage.

Primary-source constraints and links are collected in [token-funded buy source notes](token-funded-buys-sources.md). No supported or liquid RISE Testnet spot route has yet been verified; venue selection is an explicit prerequisite.

## Why an adapter instead of multi-asset reserves

Keeping WETH as the sole curve asset preserves the present reserve invariant, fee liabilities, buyback accounting, and WETH graduation pair. Adding USDC reserves inside every curve would need new pricing, redemption, accounting, and graduation rules and would be a materially larger protocol redesign. The adapter still requires a **new contract deployment and a narrow authorization change in the new curve/factory version**; it is not a frontend-only feature or a safe patch to the deployed V2 contracts.

## Testnet slice

1. Deploy a clearly labeled `MockUSDC` ERC-20 with six decimals and controlled test mint/faucet behavior. Keep its address in a testnet deployment record; never present it as real USDC. Accept standard ERC-20 behavior only in this first slice; reject fee-on-transfer and rebasing assets until they are specified and tested.
2. Provide an actual mock-USDC/WETH conversion venue with funded WETH liquidity. A mock token alone cannot be swapped. Decide between an established testnet DEX route, if independently verified and liquid, or a purpose-built **test-only** fixed-rate venue with a limited WETH inventory. The test-only venue must be excluded from any mainnet deployment configuration.
3. Deploy a new factory/curve/adapter set on RISE Testnet. Preserve the existing V2 deployment and its markets as legacy; do not silently redirect old market addresses. Record contract addresses, code hashes, venue allowlist, quote token, and deployment block.
4. Add the payment-asset picker to Buy only: ETH/WETH path unchanged, mock USDC path shows six-decimal balance, approval amount, route quote, total expected launch tokens, minimum output, and gas requirement. Start with mock USDC as the only extra asset; expand the allowlist after testnet evidence.
5. Index adapter events linking input token/amount, WETH obtained/spent, curve, beneficiary, and launch tokens received. The curve's existing `Trade` event remains the source for curve volume and fee accounting; avoid double counting the adapter swap as a second curve trade.

## Required gates before testnet broadcast

- Write the protocol spec and threat model. Decide venue integration and whether the adapter supports direct buys only or atomic launch-and-buy too. Review signer, recipient, factory/curve identity, asset and venue allowlists, approvals, callbacks/reentrancy, fee-on-transfer or rebasing tokens, decimals, stale quotes, slippage, deadlines, refunds, and rescue rules.
- TDD contract tests for success and failures: exact balance conservation across wallet/adapter/venue/curve/escrow/vault; zero adapter leftovers; WETH reserve backing; a failed swap or failed curve buy reverting the whole call; min-output/deadline enforcement; malicious venue and token behavior; approval rollback; and no unauthorized delegated buy. Include fuzz/invariant tests and a local end-to-end wallet flow.
- Test deployment on a RISE Testnet fork with the real WETH and actual venue integration selected for testnet. Then simulate the deployment and call path. A broadcast or on-chain transaction needs a fresh exact approval under `AGENTS.md`.

## Decisions still needed

1. Is the first scope **buy only**, or should a seller also be able to receive the chosen input token? Recommendation: buy only.
2. Should the first testnet route use a verified external DEX or a controlled test-only venue? Recommendation: test-only venue for deterministic contract validation, then an external venue integration before any mainnet plan.
3. Should a token-funded buy be a single wallet transaction after approval, or must the approval also be bundled through a permit mechanism? Recommendation: start with normal bounded approval and one atomic trade; treat permit as a later UX improvement.
4. Does “backend” mean quote discovery only, or is a custodial exchange service intended? Recommendation: quote discovery only. Custody would add trust, operational, and security obligations without helping the atomic curve purchase.
5. What should happen to V2 markets? Recommendation: keep them readable/tradable through their existing WETH path; route new launches to the new deployment only after testnet validation.
