# Plan: Lean Contracts V2

**Spec**: none. Planned from the owner's brief and the recon reports below (no `.planning/specs/lean-contracts-v2.md`).
**Epic**: none
**Created**: 2026-10-18
**Revised**: 2026-10-18 (rev 3, after Gate 2 review rounds 1 and 2: plan-structure reviewer and protocol reviewer)
**Status**: ready (Gate 2 passed, both reviewers ACCEPT in round 3)
**Stack**: Solidity/Foundry (`contracts/`), plus the TS/JS consumers: `src/`, `keeper/`, `services/social/`, `packages/db/`

---

## 1. Why: the research summary

Five recon passes ran in parallel: Bayview core, Bayview math and LP, the Curveball map, a Curveball bloat audit, and a Curveball security review.

### Bayview (`../bayview`): copy its shape, not its code

Bayview is lean: one controller and one token that holds its own reserve, about 800 core LOC. It has no admin at all, uses custom errors, burns the LP NFT to `address(1)`, and has a correct `sqrtPriceX96` ordering. It is **not** production grade:

| Bayview defect | Severity | What Curveball does instead |
|---|---|---|
| Buys priced against `address(this).balance` that already includes `msg.value` | High | Internal reserve accounting (already correct) |
| About $32k of reserve stranded per token after graduation | High | 100% of `realQuote` goes to the pool |
| No `minOut` or deadline on trades | High | `minOut`, `deadline` (already present) |
| Pool pre-init price griefing, mint mins of 1 wei | High | See the griefing table below |
| Pyth checked on every buy, 3h staleness, no confidence check | Medium | ETH-denominated graduation target, no oracle |
| Donations through `receive()` move price and force graduation | Medium | No `receive`, internal accounting |
| Vendored Bancor, `Power.init()` never called, SafeMath on 0.8 | Medium | Constant-product virtual reserves |
| Fork-only tests, asserts mostly `console.log` | — | Unit, fuzz and invariant tests, plus a strict fork test |

**Takeaway:** Curveball's *math and safety* are already ahead of Bayview. Its *shape* is far behind. Curveball deploys 12 service contracts plus 2 contracts per launch, with about 1,637 production LOC, while Bayview has 2 core contracts. This plan keeps Curveball's correct mechanics and adopts Bayview's leanness.

### Graduation griefing: Bayview vs. this plan

Verified in the Bayview source (`PoolCreator.sol:25`, `PoolLiquidityProvider.sol:40-41`, `BayviewContinuousToken.sol:169-217`) and in the Icarus source (`deployments/4153/icarus-Pool.sol`, `icarus-PoolFactory.sol`).

| Vector | Bayview (vulnerable) | This plan (must keep closed) | Test |
|---|---|---|---|
| Pool pre-created at a manipulated price | `createAndInitializePoolIfNecessary` does nothing if a pool exists, and the price is never checked | Reuse an existing pool only if its LP `totalSupply == 0`; `skim` to the launchpad, then first-mint. Icarus V2-style first mint sets reserves to the deposited amounts | T17 |
| **Curve tokens routed into the pool before graduation** via a `buy` recipient (the lock exempts transfers from the launchpad), enabling a "used pool" mint DoS or token-side `sync` contamination | Tokens are freely transferable | **`buy` has no recipient: tokens always go to `msg.sender`.** The `launch` first buy goes to the creator. No other pre-graduation path moves curve tokens out of the launchpad | T16: buy as a contract at the pool address / predicted address reverts or is unreachable; T17: pool token balance is 0 before graduation |
| Attacker seeds the token side another way | Tokens are freely transferable | `CurveToken` is transfer-locked except mints and transfers to and from the launchpad until `unlock()`. Approvals and `permit` can't bypass the lock | T6 |
| **Donate WETH and `sync()` to contaminate the quote reserve** (the skim can't remove it) | n/a | **Never revert on a donation.** Match the price: after the skim, `tokensToPool = min(quoteInPool · vT / vQ, available)`, where `quoteInPool = realQuote + syncedDonation` and `available = S − C − R`, taken from the excess that would otherwise be burned. Within the buffer the price is exact; beyond it the pool opens slightly above the curve-end price, funded by the donor's own WETH. No DoS | T17: clean, donation + skim, donation + `sync` inside and beyond the buffer, R = MAX |
| Liquidity accepted at any price | `amount0Min = amount1Min = 1` | Post-mint check: `reserveToken == tokensToPool` exactly, and `reserveQuote == quoteInPool` | T17 |
| Leftover assets and approvals | Leftovers stay in the contract with live approvals | Direct transfer plus `mint`, no router and no approvals; burn `balanceOf(launchpad)` of the token after the mint (which also burns skimmed token donations); the launchpad holds 0 afterwards | T17 |
| Creator's reverting `receive` blocks graduation | 1% pushed to `owner.call` inside the buyer's tx | No push payments; everything is pull from the escrow | T10 |
| Donations force or time graduation | `receive()`/`fallback()` inflate the balance | No `receive`; internal `realQuote`; donations can be rescued but are never priced | T16, T19 |
| Oracle dependency | Pyth on every buy | ETH-denominated target, no oracle | — |
| Reentrancy during graduation | `mint` has no lock; `pool` set after an external call | `nonReentrant`; `graduated` set before external calls | T17 |
| DEX broken or migrated after sellout | Unhandled | Sticky abort after `GRADUATION_TIMEOUT`, or inline in `sell` | T18 |
| The Icarus pauser forces aborts | n/a | `graduate` does not check `isPaused` (`Pool.mint` and `createPool` don't check pause; only `swap` does) | T17 |
| Wrong pool flavour | Fixed tier 3000 | Always `getPool(token, WETH, false)` / `createPool(…, false)`. A pre-created stable pool can't be seeded | T17 |

### Curveball: what is wrong today

Nothing is on RISE mainnet (4153). Only the testnet rehearsal on 11155931 exists, so the cut is cheap now.

**Security (from the security review):**
- **H-1:** `setVenue` has no timelock, and the curve sends its whole raise to any `pool_` the executor names.
- **H-2:** There is no escape once a curve is `ready`. If graduation can't complete, holders are frozen.
- **M-1:** The pool opens at a different price than the curve ends at: +6.7% at the 5% reserve, −20% at 0%. That is arbitrage against the locked LP.
- **M-2:** Holder rounds use a snapshot block the creator chooses, which can be gamed.
- **M-3:** Buyback sweeps can be sandwiched, and bought tokens vest to the owner.
- **M-4:** Icarus `gaugeFees` can take up to 50% of LP fees.
- **M-5:** The fork tests pass silently with no RPC set.
- `renounceOwnership` is not blocked on the factory.
- The fee setter allows 5.5% per side.

**Bloat (from the audit):**
- Deployer exists only to fit under the size limit.
- Venue interface plus Adapter: one implementation, checks run twice.
- Hook is a pass-through, and the fee split is written twice.
- LaunchAndBuy plus 4 create overloads.
- Rescue functions copied 7 times, and `rescueNative` can't be reached in most of them.
- Hand-rolled fee-treasury wallet.
- Token writes checkpoints on every transfer and stores the metadata URI on-chain.
- 64-slot TWAP written on every trade, used only by `sweepCurve`.
- `Services` cross-wiring and per-launch `authorize` calls.
- State stored twice: the `Market` struct, `venueOf`, `reserveBps`, `creatorOfPool`.
- Beta shims: `publicLaunchOpen`, `invited`, `canBuy`.
- `PoCIcarus` and mocks live in `src`.
- Two near-identical deploy scripts.

**Tests:** only 8 tests, and the two fork tests are vacuous without an RPC. The vault, locker→hook path, escrow claims, `launchAndBuy` and holder claims are untested. There are no invariant or fuzz tests.

**Already correct today, so the rewrite must keep it:**
- `vT0 = S` (`CurveBondingCurve.sol:118`).
- `initialVQ` exact-division and overflow guard: `target·(S−C) % C == 0`, plus uint128 bounds.
- A minimum-liquidity sanity check on the pool seed.
- On buy: `maxSpend ≤ type(uint128).max`.
- On sell: `amount ≤ sold` and `gross ≤ realQuote`.
- SafeCast on every uint128 write.
- The sellout clamp pulls exactly `spent` (no refund path).
- Balance checks against unbacked credits.
- The locker has no LP exit.

### Owner decisions (2026-10-18)

1. **Holder reserve:** a **held ledger at graduation**. It replaced Merkle rounds after both reviewers showed a creator-posted root doesn't close M-2.
   - Tokens can't move before graduation, so the launchpad records `held[token][account]` on every curve buy and sell.
   - After graduation each holder claims `reserve · held / soldAtGraduation`.
   - There is no root, no snapshot, no off-chain trust, and no rounds after graduation.
2. **Buyback:** pool-only, and bought tokens are **burned**.
3. **Escape hatch:** after `GRADUATION_TIMEOUT` stuck in `ready`, the market aborts. The abort is sticky and sells re-open.
4. **Scope:** lean rewrite. ABI changes are allowed; every consumer is updated in this plan.

---

## 2. Target architecture

There are **4 deployed singletons** (launchpad, escrow, locker, reserve), **1 internal library** (`CurveMath`), and **1 clone per launch** (token), at about 750 LOC (from 1,637).

| Component | Type | Purpose | Est. LOC |
|---|---|---|---|
| `CurveLaunchpad` | Singleton | Config and registry; `launch` (clone token + optional first buy); per-market curve state; `held` ledger; Trading → Ready → Graduated / Aborted state machine; `graduate` into the immutable Icarus factory; custody accounting; guardian pause (launch and buy only); accounted `rescue` | ~400 |
| `CurveToken` | Clone (EIP-1167) of an implementation the launchpad creates in its constructor | solady `ERC20`, which is clone-safe because its permit domain separator is computed per call from `address(this)` and `name()`. OZ `ERC20Permit` caches immutables and is **not** clone-safe. Name and symbol in storage; `initialize` launchpad-only and atomic with the clone; lock (mints plus transfers to and from the launchpad only) until `unlock`; `burn` | ~50 |
| `CurveMath` | Internal library | Pure buy/sell quoting (protocol-favouring rounding), `initialVQ` with the exact-division guard, `tokensFor(quote, vT, vQ)`, `splitFee` | ~70 |
| `CurveFeeEscrow` | Singleton | The **one** fee split (`distribute`); pull `claim` for creator and treasury; per-market buyback balance; `buyback(token)`, pool-only, burns the output; accounted `rescue` | ~140 |
| `CurveLpLocker` | Singleton | Holds LP forever; `claim(pool)` calls `claimFees()` and forwards **only the returned amounts** (mapped through `token0`/`token1`) to `escrow.distribute` | ~45 |
| `CurveHolderReserve` | Singleton | Holds the reserve tokens per launch; `claim(token)` after graduation pays `msg.sender` `reserve·held/soldAtGraduation`, once | ~45 |

### Design rules

- **Singleton curve (Uniswap v4 / pump.fun-style).** A launch costs one clone (well under 0.5M gas) instead of about 4–6M. There is one event source (`token` is an indexed topic) and no `authorize` lists.
  - Blast-radius controls:
    - A global `totalRealQuote` (updated before external calls on every buy, sell and graduation).
    - Per-market `realQuote`.
    - Invariants 1–3 and 9 in §5.
    - The guardian pause.
- **Deploy-time wiring without setters (review round 2, issue 1).** `CurveDeploy.sol` is shared by the test fixture and `Deploy.s.sol`.
  1. It precomputes the launchpad address with `vm.computeCreateAddress(deployer, nonce + 3)`.
  2. It deploys `escrow(launchpad)`, `locker(launchpad, escrow)` and `reserve(launchpad)`, then `launchpad(escrow, locker, reserve, …)`.
  3. It asserts every cross-pointer, and aborts with a clear "address prediction mismatch" error if any is wrong (for example, a deployer tx was retried).
  - The escrow authorises `msg.sender == launchpad || msg.sender == ICurveLaunchpad(launchpad).locker()`, so the escrow and locker never need each other's address before deployment.
  - The token implementation is created inside the launchpad constructor. Init code does not count toward the 24 KB limit.
- **No venue abstraction (H-1).** `icarusFactory` is an immutable, and the launchpad creates the pool itself.
- **Curve construction (kept from today).**
  - `vT0 = S` and `vQ0 = initialVQ = target·(S−C)/C` (with the exact-division guard).
  - `setGraduationTarget` requires `target ≥ MIN_TARGET` and the uint128 bounds.
  - Each market snapshots `initialVQ`.
  - `MAX_RESERVE_TOKENS = (S−C)²/S` (40k = 4% for S = 1M, C = 800k) and `MAX_RESERVE_BPS = MAX_RESERVE_TOKENS · 10_000 / S`, both computed in the constructor.
  - `launch` reverts if `reserveBps · S / 10_000 > MAX_RESERVE_TOKENS`.
- **Price continuity (M-1, revised in round 2).**
  - At graduation `quoteInPool = WETH.balanceOf(pool) + realQuote` after the skim: `realQuote` plus any `sync`-ed donation.
  - `tokensToPool = min(CurveMath.tokensFor(quoteInPool, vT, vQ), S − C − R, token.balanceOf(launchpad))`. The `min` also absorbs the few-wei sellout drift at `R = MAX`.
  - The launchpad transfers `realQuote` and `tokensToPool`, mints LP to the locker, then burns its whole remaining token balance.
  - Without a donation the pool price equals the curve-end spot to within rounding. It never reverts because of a donation.
- **State machine (H-2).**
  - `Trading` (sold < C) moves to `Ready` (sold == C, `readyAt` set by the buy that sells out; sells blocked).
  - `Ready` moves to `Graduated` (permissionless `graduate`), or to `Aborted` once `readyAt + GRADUATION_TIMEOUT` passes. The abort happens through `abortGraduation`, or inline as the first step of `sell`.
  - `Aborted` is sticky: sells are always allowed, buys while sold < C, and `graduate` whenever sold == C.
- **Pause (round 2, R3).**
  - A `guardian` (a multisig, not timelocked) can `pause()` at once. It is set at deploy and can be rotated only by the owner. ADR worst case: a compromised guardian can freeze `launch` and `buy` (including the final sellout buy) until the timelocked unpause, but can never touch funds.
  - Only the owner (timelocked) can `unpause()` or `setGuardian()`.
  - Pause blocks `launch` and `buy` only. `sell`, `graduate`, `abortGraduation`, every claim and `buyback` are never pausable.
- **Admin surface goes from about 19 functions to 8.**
  - Owner on the launchpad: `setFeeDefaults` (fee ≤ 200 bps, creator tax ≤ 50 bps; new launches only), `setGraduationTarget` (bounded; new launches only), `unpause`, `setGuardian` and `rescue`.
  - Guardian: `pause`.
  - Owner on the escrow: `rescue`.
  - `Ownable2Step` with `renounceOwnership` reverting.
  - The owner must be a multisig behind OZ `TimelockController`, enforced by the deploy preflight on 4153.
  - `treasury` is an immutable that must be a Safe, so its signers can rotate; this is accepted in the ADR.
- **Rescue scoped to custody.**
  - WETH: rescuable = `balance − totalRealQuote`.
  - A launched token: rescue reverts unless that market is graduated. After graduation nothing is owed in it, because it is burned or held by the reserve.
  - Any other asset: freely rescuable.
- **Fee policy is snapshotted per market** in the launchpad's `Market` struct, which is the single source.
- **Metadata.** `uri` is emitted in `LaunchCreated` and **not stored**. Length bounds: name ≤ 64, symbol ≤ 12, uri ≤ 2048, none empty.
- **Events.**
  - Launchpad:
    - `LaunchCreated(token, creator, name, symbol, uri, policy)`
    - `Trade(token indexed, trader indexed, isBuy, quoteAmount, tokenAmount, fee, tax, vT, vQ)`
    - `GraduationReady`, `GraduationAborted`
    - `Graduated(token, pool, quote, tokens, burned)`
    - `Paused`, `Unpaused`, `GuardianUpdated`, `FeeDefaultsUpdated`, `GraduationTargetUpdated`
  - Escrow: `FeeAccrued`, `FeeClaimed`, `BuybackBurned`, `BuybackSkipped(reason)`.
  - Locker: `LpFeesClaimed`.
  - Holder reserve: `ReserveClaimed`.
- **Quote stays WETH only.** There is no `receive`, so no `rescueNative`.
- **Buyback (M-3).**
  - Permissionless, only after graduation, at most once per `BUYBACK_INTERVAL` (1h). A chunk is `BUYBACK_CHUNK_BPS` (25%) of the balance, or all of it once that rounds to 0, capped at `BUYBACK_MAX_IMPACT_BPS` (0.25%) of the pool's quote reserve. *Done (Phase 2 review):* without the cap the buyback's own price move wedged the next one on a quiet pool.
  - It calls `pool.sync()` first, so a quiet pool's TWAP catches up after a market move.
  - It **skips** (emits `BuybackSkipped(reason)`, returns 0, doesn't start the interval) when `observationLength ≤ 3` (one window more than `quote(…, 2)` needs, keeping a pre-created pool's empty observation 0 out), when `quote` reverts (`try/catch`), when Icarus is paused (checked with `isPaused()` before any transfer instead of a `try/catch` around `swap`), or when spot is outside the band.
  - One-sided `minOut = twapOut · (1 − poolFee) · (1 − 1%)`.
  - Output is measured by balance delta, then burned.
  - The meme-token side of LP fees credited as buyback is burned directly.
  - *Done:* the escrow constructor is `(launchpad, quoteToken, icarusFactory, owner)`; Task 14's `CurveDeploy` asserts the first three match the launchpad's.
- **Locker fee attribution (M6).** `claim(pool)` uses the `(claimed0, claimed1)` that `claimFees()` returns, never `balanceOf`. The graduation skim goes to the launchpad.
- **Gauge fees (M-4).** The indexer polls `getFee(pool, false)` and `getUnstakedFee(pool)` for each graduated pool and alerts. This is a trust assumption, recorded in the ADR.
- **Holder reserve leftovers.**
  - Round-down dust, unclaimed amounts and the reserve of a market that never graduates stay in `CurveHolderReserve` forever.
  - This is accepted and recorded in the ADR. A burn-after-window option would add a function and a timer for no holder benefit.
  - Economics note for the ADR: the buyer whose purchase sells out the curve gets a pro-rata share like everyone else, and so does the creator's first buy.
- **Bytecode budget.** The launchpad must stay under 24,576 bytes with at least 2 KB headroom. This is a hard gate in Task 17.
  - The fallback, decided now, is a stateless external `CurveGraduator`.
  - The launchpad unlocks the token, transfers assets to it, and it runs pool → skim → mint → assert → returns. It is not used unless the gate fails.

### Dependencies

- Add `solady` (pinned; Permit2 infinite allowance off) and `forge-std` (`Test`, `StdInvariant`).
- Keep OZ 5.1 for `Clones`, `Math`, `SafeCast`, `SafeERC20`, `Ownable2Step` and `ReentrancyGuard`.

---

## 3. File locations

### New files

| File | Location | Purpose |
|---|---|---|
| `CurveLaunchpad.sol` | `contracts/contracts/` | Singleton registry, curve, ledger, state machine, graduation |
| `CurveToken.sol` | `contracts/contracts/` | Clone ERC20 |
| `CurveMath.sol` | `contracts/contracts/libraries/` | Pure curve and fee math |
| `CurveFeeEscrow.sol` | `contracts/contracts/` | Fee split, claims, buyback-and-burn (a new file; the old one is deleted in Task 2) |
| `CurveLpLocker.sol` | `contracts/contracts/` | Permanent LP and fee claim |
| `CurveHolderReserve.sol` | `contracts/contracts/` | Held-ledger reserve claims (a new file; the old one is deleted in Task 2) |
| `IIcarus.sol` | `contracts/contracts/interfaces/` | Factory: `getPool`, `createPool`, `getFee`, `getUnstakedFee`, `isPaused`. Pool: `skim`, `sync`, `mint`, `swap`, `claimFees`, `getReserves`, `quote`, `observationLength`, `getAmountOut`, `token0`, `totalSupply` |
| `ICurveLaunchpad.sol` | `contracts/contracts/interfaces/` | Views used by the singletons: `treasury()`, `locker()`, `curveSupply()`, `feePolicy(token)`, `poolOf(token)` (address(0) until graduated, so there is no separate `isGraduated`), `held(token, account)` |
| `ICurveSingletons.sol` | `contracts/contracts/interfaces/` | `ICurveFeeEscrow`, `ICurveLpLocker` and `ICurveHolderReserve` in one file |
| `MockIcarus.sol`, `MockWETH.sol` | `contracts/test/mocks/` | Behavioural Icarus mock (Task 8) and WETH |
| `MockLaunchpad.sol` | `contracts/test/mocks/` | Implements `ICurveLaunchpad` for the singleton unit tests |
| `CurveDeploy.sol` | `contracts/scripts/` | Shared deploy and wiring |
| `Fixture.sol` | `contracts/test/` | Full system on mocks, built with `CurveDeploy` |
| Unit tests | `contracts/test/unit/` | `CurveMath`, `CurveToken`, `FeeEscrow`, `LpLocker`, `HolderReserve`, `Deploy`, `Launchpad.{Admin,Launch,Trade,Graduate,Abort,Rescue}` (`.t.sol`) |
| `Lifecycle.t.sol` | `contracts/test/integration/` | End to end |
| `Handler.sol`, `Invariants.t.sol` | `contracts/test/invariant/` | Stateful suite |
| `Lifecycle.fork.t.sol` | `contracts/test/fork/` | Strict RISE fork against real Icarus |
| `Deploy.s.sol` | `contracts/scripts/` | One script, per-chain config, timelock and guardian preflight |
| `0003-lean-singleton-launchpad.md` | `docs/adr/` | Every decision in §2 and its trust assumptions |
| `marketState.test.ts` | `src/lib/` | New unit test for the state table |
| `indexer.test.mjs` | `services/social/src/` | New indexer replay and fee-poll tests |
| Drizzle migration | `packages/db/drizzle/` | Generated in Task 38 |
| `audit-scope.md` | `docs/` | Deliverable (Task 48), not a finding fix |

### Files to delete (Task 2, before any new code)

- Contracts: `contracts/contracts/` `CurveV1Factory.sol`, `CurveBondingCurve.sol`, `CurveLaunchDeployer.sol`, `CurveV1PoolAdapter.sol`, `interfaces/ICurveV1Venue.sol`, `interfaces/IIcarus.sol`, `CurveMemeHook.sol`, `CurveV1Locker.sol`, `CurveBuybackVault.sol`, `CurveLaunchAndBuy.sol`, `CurveLaunchFeeTreasury.sol`, `CurveLauncherToken.sol`, `CurveV1Deployment.sol`, `CurveFeeEscrow.sol`, `CurveHolderReserve.sol`, `mocks/*`, `test/PoCIcarus.sol`.
- Scripts and tests: `contracts/scripts/DeployProduction.s.sol`, `DeployTestnet.s.sol`, `check-bytecode.ts`, `contracts/test/TestBase.sol`, `V1MockGraduation.t.sol`, `fork/IcarusFactory.t.sol`.
- Justification: nothing is on mainnet, and the sources are free to refactor. Deleting first keeps `forge build` green on every later task.

### Files to change

| File | What changes | Why |
|---|---|---|
| `contracts/package.json`, `contracts/foundry.toml` | solady and forge-std, remappings, `[invariant]` config | Tooling |
| `contracts/Makefile` | Task 2: `test` becomes `forge test && forge build --sizes` (non-zero exit when any contract exceeds 24,576 bytes); deploy targets removed. Task 3: strict fork target. Task 24: deploy targets re-added against `Deploy.s.sol` | Tooling |
| `contracts/scripts/record-production.ts`, `sync-production-config.ts` | New contract set | Deploy record |
| `src/sdk/contracts.ts` | New ABIs | ABI |
| `src/sdk/sdk.ts`, `src/sdk/curveballSdk.ts`, `src/sdk/sdk.test.ts`, `src/sdk/curveballSdk.test.ts` | Market reads keyed by token on the launchpad; `launch`; claims; `buyback`; remove `sweepCurve`, `sweepBuyback` and `claimVested` | ABI |
| `src/lib/marketState.ts`, `src/components/TradePanel.tsx` | Remove the beta shims; add `ready` and `aborted`; lock copy | Shims, H-2 |
| `src/pages/LaunchPage.tsx`, `src/lib/launchForm.ts`, `src/lib/launchForm.test.ts`, `src/app/useStore.js` | One `launch` call with an optional first buy; 4% reserve cap (default 4) | ABI |
| `src/deployment.ts`, `src/lib/web3.ts` | New address set and env var names | ABI |
| `src/creatorTokens.ts`, `src/creatorTokens.test.ts` | Drop `venueOf`, `isMock`, `launchAndBuy` | ABI |
| `src/pages/MarketPage.tsx`, `src/pages/MarketsPage.tsx` | Market state from the launchpad by token | ABI |
| `src/components/MilestonePanel.tsx` | Locker `claim` | ABI |
| `src/components/MarketChart.tsx`, `src/lib/marketChart.ts`, `src/lib/marketChart.test.ts` | Filter `Trade` by launchpad address plus `token` topic | Single emitter |
| `src/lib/marketPreviewStats.ts`, `src/lib/useMarketPreviewStats.ts`, `src/lib/marketPreviewStats.test.ts` | Same | Single emitter |
| `src/lib/protocolStats.ts`, `src/lib/protocolStats.test.ts` | Escrow and quote reads | ABI |
| `src/pages/AdminPage.tsx`, `src/lib/adminFees.ts`, `src/lib/adminFees.test.ts` | New bounds; pause and unpause; venue and vesting removed | Admin |
| `src/components/HolderAirdropPanel.tsx` | `claimable(token, account)` and `claim` once after graduation | Decision 1 |
| `keeper/graduation-keeper.mjs`, `keeper/graduation-keeper.test.mjs` | Graduate; abort after the timeout; buyback cadence | Lifecycle |
| `packages/db/src/schema.ts` (+ generated migration and meta) | `reserve_rounds` becomes `reserve_claims`; `buyback_executions` gets a burned amount and drops vesting; market state gains `aborted` | Event schema |
| `services/social/src/indexer.mjs`, `services/social/src/config.mjs` | One launchpad source; new event shapes; per-pool fee polling | Event schema, M-4 |
| `.env.example`, `keeper/.env.example`, `services/social/.env.example` | `*_FACTORY_ADDRESS` becomes `*_LAUNCHPAD_ADDRESS` plus a start block | Ops |
| `services/social/compose.example.yaml`, `keeper/README.md`, `services/social/README.md` | Same | Ops |
| `GLOSSARY.md`, `README.md`, `docs/architecture/social-trading-backend.md` | Define ready, aborted, held, custody, guardian; new contract names | Docs |

---

## 4. Tasks

Each task is one commit, touches at most 3 files including its tests, and is test-first. `forge fmt --check`, `forge build` and `forge test` must be green at the end of every contract task; the consumer tasks run `bun test <files>` or `node --test`.

Two exceptions are accepted: Task 2 is a pure deletion, and Task 38 also commits drizzle-generated migration and meta files.

### Phase 0: Tooling and clean slate

| # | Task | Files | Test |
|---|---|---|---|
| 1 | Add `solady` and `forge-std` (pinned); remappings; `[invariant] runs=256 depth=64 fail_on_revert=false` | `contracts/package.json`, `contracts/foundry.toml` | `forge build` passes |
| 2 | **Delete the V1 stack** (§3); the Makefile `test` target becomes `forge test && forge build --sizes`; remove the deploy targets | delete list, `contracts/Makefile` | `forge build` and `forge build --sizes` green on an empty tree (`forge test` first runs in Task 5) |
| 3 | Strict fork Makefile target (fails without an RPC) and a check that an oversized contract fails | `contracts/Makefile` | A temporary oversized dummy makes `make test` fail (dummy not committed) |
| 4 | ADR 0003 | `docs/adr/0003-lean-singleton-launchpad.md` | Review |

### Phase 1: Leaves and seams (depends on Phase 0)

| # | Task | Files | Test |
|---|---|---|---|
| 5 | `CurveMath`: `quoteBuy`, `quoteSell`, `initialVQ`, `tokensFor`, `splitFee` | `libraries/CurveMath.sol`, `test/unit/CurveMath.t.sol` | Fuzz: k never decreases; no round-trip profit; fees sum exactly; zero output reverts; `initialVQ` rejects bad targets; sellout drift stays within a few wei; `tokensFor` at sellout ≤ `S−C−R` + drift, with the boundary R = MAX fuzzed explicitly |
| 6 | `CurveToken`: solady ERC20; `initialize(name, symbol)` once, launchpad only; lock until `unlock`; `burn` | `CurveToken.sol`, `test/unit/CurveToken.t.sol` | Init twice reverts; locked transfer between third parties reverts; `approve` + `transferFrom` and `permit` + `transferFrom` to a third party revert while locked; mint and launchpad transfers pass; permit on a clone; burn |
| 7 | Seam interfaces. *Done: no `ICurveToken`; the launchpad must import `CurveToken` to deploy it, and the escrow only calls `burn`* | `interfaces/ICurveLaunchpad.sol`, `interfaces/ICurveSingletons.sol` | Compiles |
| 8 | `IIcarus` plus a **behavioural** `MockIcarus`, checked against the Icarus sources. It covers: `createPool` (reverts if it exists); `getPool`; first-mint `sqrt(a0·a1) − 1000` with `MINIMUM_LIQUIDITY` to `address(1)`; later mints; `skim`; `sync`; `swap` (pause check) and `getAmountOut` with fee; `claimFees` returning claimed amounts with an unstaked-fee split; observations every 1800 s and `quote(…, g)` underflow when observations are too few; `isPaused`, `getFee`, `getUnstakedFee` | `interfaces/IIcarus.sol`, `test/mocks/MockIcarus.sol`, `test/mocks/MockWETH.sol`, `test/unit/MockIcarus.t.sol` | *Done:* the self-test lives in `MockIcarus.t.sol` (4 files, following the repo's test-file convention); pools are CREATE2 with the real salt |

### Phase 2: Singletons (Task 9 first, then Tasks 10–12 in parallel; depend on Tasks 7–8)

| # | Task | Files | Test |
|---|---|---|---|
| 9 | `MockLaunchpad` (settable markets, ledger, graduation flag, `locker()`) | `test/mocks/MockLaunchpad.sol` | Used by 10–12. *Done:* it owns a real `CurveToken` implementation, so its clones keep the transfer lock |
| 10 | `CurveFeeEscrow`: `distribute` (launchpad or `launchpad.locker()` only; balance-checked); `claim`; `buyback` as in §2; meme-side share burned; accounted `rescue` | `CurveFeeEscrow.sol`, `test/unit/FeeEscrow.t.sol` | Split sums exactly; an unbacked credit reverts; an unauthorised caller reverts; a second claim pays 0; buyback before graduation reverts; inside the interval reverts; fewer than 3 observations, `quote` revert and paused pool → `BuybackSkipped`; a sandwich inside the band makes the `minOut` revert; supply goes down by the burned amount; `rescue` can't touch liabilities |
| 11 | `CurveLpLocker`: `register` (launchpad only); `claim(pool)` with the returned amounts; no LP exit | `CurveLpLocker.sol`, `test/unit/LpLocker.t.sol` | No function moves the LP; two pools plus a stray balance: each claim routes only its own fees; an unregistered pool reverts |
| 12 | `CurveHolderReserve`: `register(token, amount)` (launchpad only); `claimable(token, account)`; `claim(token)` after graduation, once | `CurveHolderReserve.sol`, `test/unit/HolderReserve.t.sol` | Before graduation reverts; double claim reverts; fuzz: Σ claims ≤ reserve; zero `held` gets 0 |

### Phase 3: The launchpad (depends on Phases 1 and 2; same file, so sequential)

| # | Task | Files | Test |
|---|---|---|---|
| 13 | Constructor (immutables; creates the token implementation; `MAX_RESERVE_*`), `Ownable2Step`, `renounceOwnership` reverts, `setFeeDefaults`, `setGraduationTarget` (`MIN_TARGET`, exact division, bounds), guardian `pause`, owner `unpause` and `setGuardian` | `CurveLaunchpad.sol`, `test/unit/Launchpad.Admin.t.sol` | Bounds, including `creatorShareBps + buybackShareBps ≤ 10_000` (the escrow's split underflows otherwise; Phase 2 review); non-owner and non-guardian reverts; the guardian can pause but not unpause; renounce reverts; two-step handoff |
| 14 | `CurveDeploy` (precomputed address, prediction-mismatch abort) plus `Fixture` | `scripts/CurveDeploy.sol`, `test/Fixture.sol`, `test/unit/Deploy.t.sol` | Every cross-pointer asserted; a forced nonce shift aborts with the mismatch error |
| 15 | `launch(name, symbol, uri, taxBps, reserveBps, maxSpend, minOut)`: bounds; fee to the treasury; deterministic clone (salt `keccak256(msg.sender, nonce++)`), initialised atomically; mints `S − R` to the launchpad and `R` to the reserve; `register`; snapshot `Market` and `initialVQ`; `uri` emitted, not stored; optional first buy to `msg.sender` | `CurveLaunchpad.sol`, `test/unit/Launchpad.Launch.t.sol` | Reserve over the max reverts (in bps→token units); string bounds; fee received; predicted address; first-buy `minOut`; paused reverts; setters after launch don't change an existing market's policy or `initialVQ` |
| 16 | `buy(token, maxSpend, minOut, deadline)` (**no recipient**; tokens to `msg.sender`) and `sell(token, amount, minOut, deadline)` (WETH to `msg.sender`); `nonReentrant`; SafeCast; the clamp pulls exactly `spent`; `held` ledger; `totalRealQuote`; fees go to `escrow.distribute`; `readyAt` at sellout; sells blocked while `Ready` | `CurveLaunchpad.sol`, `test/unit/Launchpad.Trade.t.sol` | Slippage and deadline reverts; the clamp charges exactly `spent`; sellout `realQuote ≥ target` and within the drift bound; `held == balanceOf` for every buyer; no path delivers curve tokens to an address that didn't call `buy` (the pool address and predicted pool address stay at 0); two markets are isolated; paused blocks buy but not sell |
| 17 | `graduate(token)`: CEI; **`unlock` before any pool call**; get or create the volatile pool; require LP supply 0; `skim` to the launchpad; compute `quoteInPool` and `tokensToPool = min(…)`; transfer; mint LP to the locker; post-mint assertion; burn the remaining balance; `locker.register`; no pause check. **Size gate:** at least 2 KB headroom, else the `CurveGraduator` fallback in the next commit | `CurveLaunchpad.sol`, `test/unit/Launchpad.Graduate.t.sol` | Pool price equals the curve-end spot for R ∈ {0, 1%, MAX}; pre-created pool: clean / WETH donation + skim / WETH donation + `sync` inside and beyond the buffer (never reverts) / used pool reverts; Icarus paused still graduates; a donation far larger than the buffer neither reverts nor yields a premium above the clamp; the pool's token balance is 0 immediately before the transfer; the launchpad holds 0 of the token afterwards; token unlocked; `totalRealQuote` decremented; graduation only at `sold == curveSupply`, so Σ`held` == `curveSupply` (the holder reserve's denominator; Phase 2 review) |
| 18 | Abort: `abortGraduation` after the timeout, and inline in `sell`; the sticky `Aborted` state | `CurveLaunchpad.sol`, `test/unit/Launchpad.Abort.t.sol` | Before the timeout reverts; after it, a direct `sell` succeeds in one transaction; a dust sell then rebuy does not re-block sells; `graduate` from `Aborted` at sold == C; a graduated market can't abort; `held` stays consistent across the abort |
| 19 | Accounted `rescue` | `CurveLaunchpad.sol`, `test/unit/Launchpad.Rescue.t.sol` | WETH limited to `balance − totalRealQuote`; a launched token reverts before graduation; a stray token is rescued; skimmed WETH is rescued |

### Phase 4: Integration and invariants (depends on Phase 3)

| # | Task | Files | Test |
|---|---|---|---|
| 20 | Lifecycle: launch → trades → sellout → graduate → swaps → locker claim → escrow claims → buyback-and-burn → reserve claims | `test/integration/Lifecycle.t.sol` | Balance assertions at every step |
| 21 | Invariant handler: launch, buy, sell, donate (WETH and token to the launchpad and pool), warp, graduate, abort, swap, lpClaim, feeClaim, buyback, reserveClaim, pause; ghost counters | `test/invariant/Handler.sol` | Used by 22 |
| 22 | Invariants (§5), including the `afterInvariant` coverage check | `test/invariant/Invariants.t.sol` | 256 × 64 green; fails if an action category ran fewer than N times |
| 23 | Strict fork lifecycle (`vm.skip` only when `CI_FORK != 1`; fails loud otherwise) | `test/fork/Lifecycle.fork.t.sol` | 4153 and 11155931 forks: real first-mint, `sync`-donation handling, `claimFees` with the real unstaked fee, TWAP after 3 observations |

### Phase 5: Deploy (depends on Phase 4)

| # | Task | Files | Test |
|---|---|---|---|
| 24 | `Deploy.s.sol` on top of `CurveDeploy`: per-chain config; on 4153, the preflight requires the owner to be a `TimelockController` with a multisig proposer, and the guardian and treasury to be contracts; re-add the Makefile deploy targets | `scripts/Deploy.s.sol`, `contracts/Makefile` | Fork dry-run; wiring asserts |
| 25 | Record scripts | `scripts/record-production.ts`, `scripts/sync-production-config.ts` | Run against a local anvil deploy |

### Phase 6: Off-chain consumers (depends on Task 24's ABI)

| # | Task | Files | Test |
|---|---|---|---|
| 26 | Regenerate the ABIs | `src/sdk/contracts.ts` | Typecheck |
| 27 | SDK | `src/sdk/sdk.ts`, `src/sdk/sdk.test.ts` | `bun test src/sdk/sdk.test.ts` |
| 28 | High-level SDK, plus the store's launch call | `src/sdk/curveballSdk.ts`, `src/sdk/curveballSdk.test.ts`, `src/app/useStore.js` | `bun test` |
| 29 | Address set and env | `src/deployment.ts`, `src/lib/web3.ts` | Typecheck |
| 30 | Creator tokens | `src/creatorTokens.ts`, `src/creatorTokens.test.ts` | `bun test` |
| 31 | Market state table and TradePanel | `src/lib/marketState.ts`, `src/lib/marketState.test.ts` (new), `src/components/TradePanel.tsx` | State table: trading / ready / aborted / graduated / paused |
| 32 | Launch flow: the cap logic lives in `canSubmitLaunch`; the default `draftReservePercent` changes from 5 to 4 | `src/pages/LaunchPage.tsx`, `src/lib/launchForm.ts`, `src/lib/launchForm.test.ts` | Reserve cap; with and without a first buy |
| 33 | Market pages | `src/pages/MarketPage.tsx`, `src/pages/MarketsPage.tsx` | Typecheck plus browser QA (Task 47); the logic lives in the tested libs |
| 34 | Milestone panel | `src/components/MilestonePanel.tsx` | Typecheck plus browser QA |
| 35 | Chart | `src/components/MarketChart.tsx`, `src/lib/marketChart.ts`, `src/lib/marketChart.test.ts` | Decoding fixture logs from the single emitter |
| 36 | Preview stats | `src/lib/marketPreviewStats.ts`, `src/lib/useMarketPreviewStats.ts`, `src/lib/marketPreviewStats.test.ts` | `bun test` |
| 37 | Protocol stats | `src/lib/protocolStats.ts`, `src/lib/protocolStats.test.ts` | `bun test` |
| 38 | DB schema plus migration (generated files exempt) | `packages/db/src/schema.ts` + `drizzle-kit generate` output | Migrate up on a scratch DB |
| 39 | Admin | `src/pages/AdminPage.tsx`, `src/lib/adminFees.ts`, `src/lib/adminFees.test.ts` | `bun test` |
| 40 | Holder reserve panel | `src/components/HolderAirdropPanel.tsx` | Typecheck plus browser QA (claimable, claimed, before graduation) |
| 41 | Keeper | `keeper/graduation-keeper.mjs`, `keeper/graduation-keeper.test.mjs` | Decision table: Ready → graduate; past the timeout → abort; graduated and past the interval → buyback; Icarus paused → still graduate; `BuybackSkipped` → back off |
| 42 | Indexer: source, event shapes and fee polling | `services/social/src/indexer.mjs`, `services/social/src/config.mjs`, `services/social/src/indexer.test.mjs` (new) | Replay recorded logs; fee-poll alert with a stubbed client |
| 43 | Ops env examples | `.env.example`, `keeper/.env.example`, `services/social/.env.example` | Review |
| 44 | Ops compose and READMEs | `services/social/compose.example.yaml`, `keeper/README.md`, `services/social/README.md` | Review |
| 45 | Docs | `GLOSSARY.md`, `README.md`, `docs/architecture/social-trading-backend.md` | Review |

### Phase 7: Rehearsal (depends on everything; outward-facing, so confirm with the owner first)

| # | Task | Files | Test |
|---|---|---|---|
| 46 | Testnet 11155931 redeploy, Blockscout verify, record; point the keeper and indexer at the new launchpad and start block | `deployments/11155931/*` | `make test-fork-testnet`; indexer catches up; keeper graduates a test market |
| 47 | Browser QA of the full lifecycle, including abort and reserve claims | — | `/spartan:qa` |
| 48 | *Deliverable, not a finding fix:* audit scope plus incident runbook | `docs/audit-scope.md` | Review |

### Parallel and sequential

| Parallel group | Tasks | Why |
|---|---|---|
| A | 1 → 2 → 3, with 4 in parallel | 4 is docs only |
| B | 5, 6, 7, 8 | Leaves; no cross-imports |
| C | 10, 11, 12 (after 9) | Seam interfaces plus mocks only |
| D1 | 27 → 28, and 29 (after 26) | SDK and address layer |
| D2 | 30–37, 39, 40 (after 27, 28, 29) | UI and libs over the SDK and addresses; 31 → 32 in order (both touch store-driven flows) |
| D3 | 38 → 42; 41; 43, 44, 45 | DB then indexer; keeper; ops and docs |

| Sequential | Depends on | Why |
|---|---|---|
| 13 → 19 | 5–12 | The same file; Task 14's fixture uses the real singletons |
| Task 17's size gate | 17 | Real bytecode exists only once graduation is written |
| 20 → 23 | 19 | The whole system |
| 24 | 20 | `CurveDeploy` is proven by the fixture |
| 26 | 24 | The ABI is frozen |
| 46, 47 | 23, 25, 27–45 | End-to-end rehearsal |

---

## 5. Testing plan

**Math and fuzz (Task 5).**
- k is non-decreasing.
- No round-trip profit.
- Rounding favours the protocol.
- Fee and tax splits are exact.
- Dust trades revert or pay a nonzero fee.
- The `initialVQ` guard holds.
- Drift is bounded.
- `tokensFor` stays within bounds at R = MAX.

**Business logic (unit tests, Tasks 6 and 10–19).**
Every H and M finding, and every row of the griefing table, has a named test:
- H-1: there is no redirect setter.
- H-2: sticky abort plus inline abort.
- M-1: continuity for R ∈ {0, 1%, MAX}, plus donation price-matching.
- M-2: the held ledger, with no creator input.
- M-3: interval, chunk, skips, one-sided `minOut`, sandwich, burn.
- M-4: polling.
- M-5: strict fork.
- R1: no recipient path.
- R3: the guardian pause.
- Access-control negatives on every restricted function.

**Invariants (Task 22).**
1. `WETH.balanceOf(launchpad) ≥ totalRealQuote == Σ realQuote` over ungraduated markets.
2. Per market before graduation: `realQuote == virtualQuote − initialVQ`. After graduation it is 0.
3. Per market: `sold + virtualToken == S` and `sold ≤ C`. Before graduation, `token.balanceOf(launchpad) ≥ S − R − sold` (≥ because of donations).
4. `WETH.balanceOf(escrow) ≥ Σ liabilities + Σ buyback balances`. The same holds for each meme token.
5. Per market before graduation: `Σ held == sold`, and `held[a] ≥ token.balanceOf(a)` for every account other than the launchpad and the reserve. It is ≥ because a holder may donate to the launchpad; the token side of the pool stays 0.
6. Per market: `Σ reserve claims ≤ R`.
7. Locker LP balance per pool is non-decreasing.
8. State machine:
   - Graduated never trades on the curve.
   - Aborted never blocks sells.
   - Ready blocks sells only before the timeout.
   - Pause never blocks sell, graduate, abort or claims.
9. Token `totalSupply` is non-increasing after launch.
10. The handler reached every action category (checked in `afterInvariant`).

**Integration and fork (Tasks 20 and 23).** The full lifecycle on mocks and on real Icarus.

**Off-chain (Tasks 27–42).**
- SDK and lib unit tests.
- Keeper decision table.
- Migration up.
- Indexer replay.
- UI states via `marketState.test.ts` plus browser QA (Task 47) for the pages that have no test harness today.

---

## 6. Gate 2

The repo's layered backend rule doesn't apply: there is no Kotlin or Next.js. It is adapted below. Contracts depend downward only, and the interfaces sit at the seams.

**Architecture**
- [x] Follows existing patterns: Foundry layout, OZ 5.1, the `Curve*` prefix, `make test` as the CI entry point, ADRs in `docs/adr/`, drizzle migrations, and the existing `*.test.*` convention.
- [x] Each layer calls only the layer below.
  - The launchpad calls the token, escrow, locker, reserve and Icarus.
  - `CurveToken.initialize(name, symbol, supply, reserveRecipient, reserveAmount)` mints the entire supply at launch, and there is no other mint, so invariant 9 holds by construction.
  - `ICurveFeeEscrow.distribute(token, asset, fee, tax)` takes fee and tax separately (tax goes 100% to the creator; LP fees pass tax = 0).
  - The locker calls the pool and escrow.
  - The escrow calls the pool and token, and reads `launchpad.locker()`.
  - The reserve calls the token.
  - Back-references go only through `ICurveLaunchpad` views. The deploy-time cycle is resolved by precomputing one address plus a runtime view.
- [x] Components are in the right directories.

**Task breakdown**
- [x] All files to change are listed. The consumer grep was re-run in round 2 and no further consumers were found.
- [x] All new files are listed with their locations.
- [x] Each task touches at most 3 files including its tests. The exceptions (Tasks 2 and 38) are stated.
- [x] Dependencies are explicit.
- [x] Parallel and sequential work is marked.

**Testing**
- [x] Data layer: invariants 1–6, the migration, the indexer replay.
- [x] Business logic: unit and fuzz for every contract.
- [x] API and integration: lifecycle, strict fork, keeper, indexer.
- [x] UI: the state table plus browser QA; lib tests for the chart, stats and launch form.
- [x] Edge cases: the full griefing table (including the R1 recipient route and `sync` donations), the re-sellout loop, drift at R = MAX, dust, the clamp, cross-pool fees, a vacuous handler, a nonce-prediction mismatch.

**Gate 2: PASS (rev 3). Both reviewers ACCEPT in round 3.**

---

## 7. Review log

**Round 1, plan-structure reviewer:** 18 issues, all resolved in rev 2. Build order, constructor cycle, deletion first, held ledger, size gate moved, graduator seam, consumers, DB and ops, mock, rescue, buyback `minOut`, URI, lock UX, Makefile, pause, handler, grep.

**Round 1, protocol reviewer:** B1, M1–M7 and minors, all resolved in rev 2. Tolerance (since superseded by price-matching), no pause check, sticky abort, TWAP semantics, held ledger, restored guards, locker attribution, pause.

**Round 2, plan-structure reviewer: NEEDS CHANGES (no blockers). Resolved in rev 3:**
1. Escrow and locker cycle → the escrow reads `launchpad.locker()` at runtime.
2. Donation DoS beyond the tolerance → price-matching with `min(…)`; never reverts.
3. Invariant 3 → `sold + vT == S` (`vT0 = S`).
4. Reserve leftovers → stranded by design, in the ADR.
5. Interface files → `ICurveSingletons.sol` used consistently.
6. Task 38 → stated exemption.
7. Test files listed; market pages split (Tasks 33–34).
8. Admin tests folded into Task 13; deploy and fixture moved to Task 14.
9. Makefile repointed in Task 2.
10–11. References renumbered, and stale references fixed.
12. D2 depends on 27, 28 and 29.
13. `MAX_RESERVE_TOKENS` and `MAX_RESERVE_BPS`.
14. Prediction-mismatch abort plus a test.

**Round 2, protocol reviewer: NEEDS CHANGES (1 blocker). Resolved in rev 3:**
- **R1** (the `buy` recipient routes tokens to the pool) → recipient removed; tests for the pool and predicted addresses.
- **R2** (`tokensForPool` above the available supply at R = MAX) → `min(…)` clamp plus a boundary fuzz.
- **R3** (a timelocked pause is useless) → an instant guardian pause; unpause timelocked.
- Minors:
  - Invariants 3 and 5 use ≥.
  - The burn is `balanceOf` after the mint.
  - Buyback skips on a paused swap.
  - Reserve dust is documented.

**Round 3, plan-structure reviewer: ACCEPT.** Three minor items applied: the Task 32 files (`launchForm.ts`, with `useStore.js` moved to Task 28), the guardian wording, and the Task 2 acceptance check.

**Round 3, protocol reviewer: ACCEPT.** Minor items applied: a third `balanceOf` clamp in `tokensToPool`, a large-donation test, a pre-transfer pool-token-balance assert, and the guardian worst case recorded in the ADR. Also noted for Task 17: the "used pool" guard is now only reachable through a mock hack, and Task 5's `MIN_TARGET` fuzz must cover the clamped case.

**Phase 2 gate (protocol reviewer): NEEDS CHANGES → ACCEPT in 2 rounds.** Major: buyback could wedge on quiet pools (its own price move, or one market move, left spot outside the band and every call reverted). Fixed with the 0.25% impact cap, `sync()` before quoting, and skip-on-slippage, each mutation-checked by a test. Also: one extra observation window, the dust rule, and Phase 3 requirements for the fee-share sum and full-sellout graduation.

**Accepted as-is:** Task 2 and Task 38 file-count exceptions; Gate 2 rule adaptation; Task 48 as a labelled deliverable; the dust-sell delay in `Aborted`.

---

## 8. Open questions (non-blocking; defaults chosen)

- `GRADUATION_TIMEOUT`: 7 days. Pause can't block graduation now, so this only matters for a broken or migrated DEX; 3 days is also reasonable.
- An attacker in `Aborted` can delay re-graduation with dust sells at about 1.5% per round trip. The keeper bundles the final buy and `graduate`. Accepted.
- Buyback parameters: chunk 25%, interval 1h, 1% band, 0.25% impact cap. Tune them on testnet: the cap limits spend to about 0.25% of the pool's quote reserve per hour, which a busy pool's fees can outpace. The keeper should back off on `BuybackSkipped`.
- `MIN_TARGET`: fix it in Task 13 so that `sqrt(tokensToPool · target) ≥ 10⁶ · MINIMUM_LIQUIDITY`.
- No recipient on `buy` means routers and aggregators can't buy on behalf of users before graduation. Smart wallets still work, because `msg.sender` is the wallet.
