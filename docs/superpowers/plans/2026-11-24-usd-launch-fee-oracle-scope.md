# $1 launch fee on RISE: implementation scope

Status: implementation in progress, 2026-11-24. The contract, UI, SDK, multi-deployment routing, release scripts, and focused tests are implemented in the working tree. Live deployment, independent review, and production verification remain.

## Outcome and current state

On the new launchpad, every successful launch should transfer WETH worth approximately $1 at the onchain oracle price observed in that transaction. The contract must reject absent, stale, invalid, or unexpectedly expensive quotes. The launch form must show the estimated WETH fee and the maximum WETH the wallet authorizes, and existing mainnet markets must remain visible and operable.

The deployed mainnet `CurveLaunchpad` at `0xCD07f89C29E1FAE77EC1a342b5D47D9008E9a72d` reports an immutable `launchFee` of 450,000,000,000,000 wei (0.00045 WETH). Its [deployment record](../../../deployments/4153/curveball.json) confirms this. The current code sends that amount straight to the treasury in `launch()`; the owner has no setter. At the observed ETH/USDC price of about 1,672 on 2026-11-24, the old fee was about $0.75 and a $1 fee would be about 0.000598 WETH. The live public API returned one trading market on that date. Prices and market counts are observations, not constants.

## Oracle decision

RISE documents `RISExOracle` at `0x8fC4D0Cf74cdF595254cB763d4C05D38Df0e9503` and `getIndexPrice(2)` for ETH/USDC [here](https://docs.risechain.com/docs/builders/mainnet-internal-oracles); [market specifications](https://docs.risechain.com/docs/risex/trading/markets) identify market 2 as ETH/USDC. RISE also lists a distinct `RISExStork` address. These are not the direct Stork feed contract.

Stork lists its RISE mainnet and testnet proxy at `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` [here](https://docs.stork.network/resources/contract-addresses/evm). The [asset registry](https://docs.stork.network/resources/asset-id-registry) lists `ETHUSDC` as `0x7965e1bfc07a34caf0c3aa8146b200264fbb7a0eb85b1d3b1fdceecffd736b02` and `ETHUSD` as `0x59102b37de83bdda9f38ac8254e596f0d9ac61d2035c07936675e87342817160`. Stork's [pushed asset list](https://docs.stork.network/resources/stork-pushed-assets) includes ETHUSDC on RISE mainnet and testnet, but not ETHUSD on RISE. The mainnet `ETHUSDC` getter returned a current, positive price; the `ETHUSD` getter reverted `StaleValue`. The testnet ETHUSDC getter also returned a current price. The Stork contract reported a 3,600 second validity period and a one wei update fee when checked.

**Recommendation:** read the directly pushed Stork `ETHUSDC` feed from `CurveLaunchpad`. Stork returns a nanosecond Unix timestamp and a signed 18 decimal value ([EVM API](https://docs.stork.network/api-reference/contract-apis/evm), [value format](https://docs.stork.network/introduction/core-concepts)). Its timestamp lets Curveball enforce its own tighter freshness limit. The RISEx index price is a viable alternative for further evaluation, but the published two function interface exposes no timestamp, and this scope should not silently assume a freshness guarantee. Treat ETH/USDC as an approximate USD price: a strict USD peg would additionally need a USDC/USD feed or an accepted depeg policy. Do not use the stale RISE ETHUSD feed.

Use Stork's checked `getTemporalNumericValueV1`, then independently require a positive price, timestamp not in the future, and age within a chosen application window. Start evaluation with a 60 second window, measure actual feed and block timing on both networks, and set the final bound before deployment. Fail closed if the feed is unavailable or stale. Stork's 3,600 second default is too permissive for a launch quote. The direct pushed feed avoids a client supplied signed update path and its extra transaction. Monitor feed continuity because Stork is an upgradeable external dependency.

## Contract and payment design

1. Replace the immutable fixed WETH `launchFee` policy in `CurveLaunchpad` with immutable oracle address, feed ID, USD fee amount (`1e18` for $1), and a validated freshness bound. Expose `quoteLaunchFee()` returning WETH wei, oracle price, and price timestamp for clients and operators. Keep the USD target explicit in the ABI and deployment record. Pin the oracle and feed in deployment preflight; verify contract code exists and a live sample passes the proposed policy on both chains.
2. Compute WETH wei with upward rounding: `ceil(usdFeeX18 * 1e18 / ethUsdcPriceX18)`. Upward rounding prevents collecting less than $1 at wei precision. Bound valid price values and the resulting WETH fee so a bad feed cannot cause an extreme charge or overflow. Decide exact bounds from a documented economic policy, not from the old 0.01 WETH constructor cap.
3. Add `maxLaunchFeeWei` to `launch()` so a price move between review and execution cannot charge more than the creator accepted. A quote above that cap reverts before token creation or WETH transfer. The optional first buy and its `minOut` remain independent. A dedicated `LaunchFeePaid` event should record the actual WETH fee, price, and timestamp without changing the existing `LaunchCreated` event shape used by the indexer.
4. Keep treasury transfer in the same atomic launch transaction. Do not use a browser or backend price to determine the amount charged. Keep read and spend in one transaction; do not cache a fee in contract state. Define whether a stale feed blocks new launches while old markets continue trading. Recommended behavior: only new launches fail; trading and graduation remain live.
5. A changed `launch()` selector and removed or redefined `launchFee()` getter require explicit ABI version handling. Update Solidity interfaces, Foundry fixtures, invariant handlers, smoke scripts, and generated frontend ABI. Add tests for exact arithmetic, rounding, price movement across the user's cap, stale/future/zero/negative values, missing feed, oracle revert, treasury receipt, first buy, and no partial state after revert. Add strict mainnet and testnet fork tests against the actual Stork proxy and feed.

## App and SDK

1. Replace the immutable-fee reads in `src/pages/LaunchPage.tsx` and `src/sdk/sdk.ts` with `quoteLaunchFee()`. A bigint quote and its timestamp should be the source for funding, Max first buy, approval, wrap amount, fee review, and transaction arguments. Refresh on a short interval and again immediately before the wallet flow. Do not reuse the separate CoinGecko rate in `UsdAmount.tsx` as authority for the $1 fee; it is only an approximate display rate elsewhere.
2. Show `$1 anti-spam fee`, current estimated WETH, quote age or refresh status, selected max WETH fee, and total maximum WETH spend in the review dialog. Explain that the actual WETH fee can decrease and that a quote above the chosen cap fails safely. Disable submission on missing/stale quote and explain oracle outage in plain language.
3. The SDK must re-read the onchain quote before wrapping or approving, derive a fee cap from an explicit tolerance, simulate the new `launch()` call, and handle a changed quote after wrap or approval. Keep the fee cap separate from first-buy slippage. Approval and ETH wrapping must cover the cap plus first buy while preserving gas reserve; leftover wrapped WETH remains in the wallet. The UI must not imply the estimate is the exact eventual charge.
4. Update `src/lib/launchForm.ts`, the store submission path in `src/app/useStore.js`, launch progress/error text, the launch preview, `LandingPage.tsx`, `DocsPage.tsx`, and any admin copy that could confuse trading fees with the launch fee. Replace the launch fee row's CoinGecko-derived `UsdAmount` with the stated $1 target; use CoinGecko only for approximate values elsewhere. Add focused SDK/form/UI behavior tests. Confirm fee-only launches from ETH and WETH, first-buy launches, low balances, approval already present, quote refresh, and wallet rejection in a running app.

## Mainnet migration is the largest work item

The deployed launchpad cannot be changed through governance. A new launchpad and its paired escrow, locker, buyback treasury, token implementation, and tied swap adapter must be deployed and recorded. The existing market remains owned by the old launchpad. Its curve trades, graduation, claims, and data require continued support.

The code currently assumes one launchpad: `src/lib/marketFactories.ts` rejects markets from any other address, `src/app/useStore.js` filters persisted markets by that address, the backend has one `SOCIAL_LAUNCHPAD_ADDRESS` and one set of cursors, and the keeper has one `KEEPER_LAUNCHPAD_ADDRESS`. On a switch, `retirePreviousDeployment()` in `services/backend/src/indexing/indexer.mjs` marks old markets and flows orphaned and clears derived statistics. Do not run that switch unchanged. The adapter is also bound to one launchpad.

The recorded testnet deployment is older than the current mainnet release and has a different `launch()` ABI and reserve design. Fork coverage and testnet activation must account for that version explicitly. An isolated new testnet release can validate oracle charging without requiring historical testnet markets to share the mainnet migration policy.

Implement a versioned deployment registry with old and new launchpad records and an explicit target for new launches. The backend scans both contracts in each global range, advances a stream cursor only after both scans succeed, and rewinds cursors once when it registers a new deployment; market records already carry `launchpad_address`. Route frontend reads, trades, claims, charts, and swap adapters by each market's launchpad, while the launch page points only at the new deployment. Run keeper graduation and fee work for each live deployment or keep a separately configured legacy keeper until it has no obligations. Make reorg handling deployment scoped. Deploy a new swap adapter for the new launchpad if post-graduation pool trading needs it.

There is an unavoidable policy limitation: the old public launchpad can still accept direct launches at 0.00045 WETH while its buys remain enabled. Its guardian `pause` blocks both `launch` and `buy`, so pausing old launches would also stop buys on the existing trading market. The UI can steer all new launches to v3, but a chain-wide `$1 fee on every possible launch` cannot be guaranteed while the legacy market needs old-curve buys. A product decision is required on accepting this legacy bypass until the market graduates, or restricting that market's trading. Document this clearly before activation.

## Makefile, deployment, and operations

`make test` runs typecheck, Bun tests, and non-fork Foundry tests. Fork tests require `make -C contracts test-fork-strict` and `test-fork-testnet`; mainnet `production-preflight` already includes strict fork tests, bytecode checks, and a dry run. Add an explicit oracle check to the new preflight, including chain ID, code, feed ID, live price, freshness, and fee calculation. The checked price is a readiness observation, not a guarantee the feed stays live.

The current `deploy-production` target refuses to run when `deployments/4153/curveball.json` exists. A v3 release needs new versioned deployment and record targets, filenames, and verification rules. Do not overwrite the v2 record or repurpose its code hashes. `record-production.ts` hardcodes 0.00045 WETH and must validate the new USD policy, oracle wiring, price controls, and new bytecode. `sync-production-config.ts` and `deploy/prepare-production-env.mjs` must emit both the legacy registry and the new launch target for API, frontend, and keeper. Update `Smoke.s.sol`, fork suites, and the adapter deployment/record flow for the v3 address. `activate-testnet` currently resets projections and must not be reused unchanged when preserving legacy markets. `docker-fresh-testnet` deletes the database volume and is inappropriate for this migration.

Build and verify locally, then use a staged mainnet runbook: snapshot production data and config; deploy and Blockscout verify new contracts; record hashes and wiring; activate multi-deployment indexing/keeper support before changing the frontend launch target; inspect indexer lag and the old market; run a small live launch; then release the UI. Rollback should restore the prior app/config and keep both contract addresses recorded. If the new oracle fails, stop offering new launches; preserve old market trading. Contract deployment is irreversible, so the mainnet broadcast needs a separate release decision after all checks.

Update `README.md`, `contracts/README.md`, protocol/integration/glossary docs, mainnet economics review, operational runbook, and public docs page. Some existing README text incorrectly says no mainnet deployment record exists; correct it while documenting the new release. Monitor feed age and price, `quoteLaunchFee()` failures, fee paid events, launch success/reverts, indexer cursors per deployment, and keeper health. Avoid putting any oracle API credentials or private RPC URLs in public `VITE_` settings.

## Delivery sequence and estimate

| Unit                                                   | Verifiable gate                                                        | Rough engineering effort |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | -----------------------: |
| Oracle policy and live probe                           | Repeatable mainnet/testnet read; chosen age, price, and depeg rules    |                 1–2 days |
| Contract, interface, unit and fork tests               | `$1` equivalent WETH paid; all failure and rounding cases pass         |                 3–5 days |
| Multi-deployment data, SDK routing, keeper and adapter | Legacy market still trades, graduates, appears in API; v3 markets work |                6–10 days |
| Launch UI and wallet flow                              | Browser verifies ETH/WETH funding, cap, review, failure and success    |                 2–4 days |
| Release tooling, records, docs and staged rollout      | Versioned records, preflight, verification, local and mainnet smoke    |                 4–7 days |

**Planning estimate:** roughly 16–28 engineering days for one developer, plus independent contract review and mainnet rollout time. It assumes preserving the live legacy market and no new oracle pusher. This is a sizing estimate, not a commitment. A frontend-only dollar display is much smaller but cannot enforce the fee. Adding a strict USD peg or a self-run Stork pusher adds another workstream.

## Implemented policy choices

1. ETH/USDC is the approximate dollar reference; there is no USDC/USD depeg guard.
2. The contract accepts oracle samples no older than 60 seconds, prices from 100 to 100,000 USDC per ETH, and fees no greater than 0.01 WETH. The UI accepts a fee at most 1% above its displayed quote.
3. The UI launches only through v3 and retains legacy market trading. Direct legacy contract launches remain possible at the old fee.
4. The $1 target is immutable in v3.

## Proof of completion

The feature is complete when mainnet fork and live smoke tests show a fresh Stork quote, a launch transfers the rounded $1-equivalent WETH amount and no more than the creator's cap, stale/invalid oracle reads safely block only new launches, the new UI quotes and funds that exact contract path, and the existing trading market remains tradable, indexed, and eligible for keeper actions after the new release is active.
