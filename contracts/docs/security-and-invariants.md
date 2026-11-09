# Security properties and verification

This document collects the properties the implementation attempts to preserve and points to executable evidence. It is not an audit report and does not assert the absence of vulnerabilities.

## Security model

### Assets protected

- WETH backing every ungraduated curve.
- Creator and treasury fee claims.
- WETH reserved for future CURVE buybacks.
- Market-token fee credits awaiting conversion into that WETH budget.
- Unsold curve-token inventory.
- Graduated pool LP principal.
- Correct market lifecycle and immutable per-market economic policy.

### Trusted authorities

- Launchpad, escrow, and buyback treasury start with the same configured owner but have independent two-step ownership thereafter. The launchpad owner can update future-market defaults, rotate guardian, unpause, and rescue launchpad surplus; the escrow owner can rescue escrow surplus; the buyback treasury owner selects CURVE once and can trigger buybacks without waiting for staleness. Mainnet deployment requires the initial shared owner to expose a nonzero timelock delay.
- The guardian can stop new launches and buys, but cannot stop exits or seize assets.
- The treasury is an immutable recipient rather than an active authority.
- The configured Icarus factory/pools and RISE WETH are external trust dependencies.

### Untrusted actors

Creators, traders, claimants, buyback callers, LP-fee callers, pool pre-creators, token/quote donors, and transaction-ordering adversaries are treated as untrusted. Permissionless functions must remain safe regardless of which account triggers them.

## Executable invariants

The stateful invariant harness targets 19 actions across launch, trading, donations, pool activity, claims, rescue, administration, and pauses. Its configuration runs 256 sequences to depth 64 and requires at least 20% of calls to reach meaningful action paths.

### 1. Launchpad curve backing

```text
totalRealQuote = Σ market.realQuote
WETH balance of launchpad = totalRealQuote + tracked surplus
```

Surplus includes donations and skimmed pool balances, net of authorized rescues. Evidence: `invariant_launchpadBacksEveryCurve`.

### 2. Global WETH conservation

Every unit of mock WETH minted remains accounted for among actors, treasury, rescue sink, Curveball singletons, pools, LP fee holders, and gauge fee holders. Evidence: `invariant_wethConserved`.

### 3. Curve accounting and inventory

For every market:

```text
sold = SUPPLY − virtualToken
sold <= CURVE_SUPPLY
```

Before graduation:

```text
realQuote = virtualQuote − initialVirtualQuote
pool == address(0)
launchpad token balance >= SUPPLY − sold
```

After graduation, `realQuote == 0`, all launchpad inventory except explicit later donations has been seeded or burned, and the locker owns positive LP. Evidence: `invariant_curveAccounting`.

### 4. Escrow solvency

For every asset:

```text
escrow balance >= totalOwed
```

For each asset, escrow `totalOwed` equals creator and treasury claims. The separate buyback treasury backs its global WETH budget and per-market token conversion credits. Evidence: `invariant_escrowBacksEveryClaim`.

### 5. Historical held ledger

```text
Σ held[token][actor] = SUPPLY − market.virtualToken
```

Before graduation, each tracked actor's held amount bounds its transferable balance and no market tokens are present in a pre-created Icarus pool. Evidence: `invariant_heldLedgerMatchesSales`.

### 6. Handler-enforced properties

The handler records a violation if observed behavior contradicts:

- permanent LP custody;
- allowed market state transitions;
- pause scope;
- token supply changes;
- expected trade, claim, buyback, and rescue effects.

`invariant_handlerSawNoViolation` requires the violation count to remain zero. Deterministic reachability tests separately ensure every action and rare path is executable, preventing a vacuous fuzz result.

## Additional designed properties

### Curve-favorable rounding

Both buy and sell formulas use ceiling division for the new opposing reserve. This keeps the post-trade virtual product at or above the pre-trade product. Curve fee, creator tax, and opening anti-snipe tax charges round down. When the realized curve fee is split, division remainder not assigned to creator or buyback accrues to the protocol share. Fuzz tests assert that round trips cannot profit and sells cannot exceed real reserves.

### No pre-graduation pool seeding by traders

Three controls combine:

1. Curve buys have no recipient parameter.
2. Bought tokens go only to the payer.
3. Before unlock, the launchpad can move tokens out or call `transferFrom` to receive tokens for a sell; a holder cannot transfer directly to another address or even to the launchpad.

This prevents ordinary holders from transferring market tokens into their future Icarus pool before the launchpad performs controlled graduation. Synced token contamination is still checked and rejected as defense in depth against behavior outside the normal holder interface or a compromised external dependency.

### Market policy immutability

Creator, fee rate, creator share, buyback share, tax, and starting virtual quote are stored in the market at launch. Owner changes affect only future markets.

The wallet cap is fixed in the launchpad constructor, measured against each address's net `held` balance, and restored by curve sells. It cannot enforce a person-level limit across multiple addresses. The opening anti-snipe rate is time dependent rather than part of the market's fee snapshot: buys in launch seconds 0–4 pay an additional 9,900/2,500/300/36/4 bps to the treasury, while sells and later buys do not. The extra tax is included in all-in spend and buy previews.

### Exit liveness under pause

The guardian pause blocks new exposure—launches and buys—but not sells. It also does not block graduation, abort after timeout, fee claims, or LP fee collection. Icarus swap pause blocks buyback execution but is deliberately not checked during graduation.

### Stuck-graduation escape

After seven days, a sold-out market can enter sticky `Aborted` state. Sells reopen and remain open permanently. If the market sells out again, anyone can retry graduation without first restoring `Ready`.

### Liability-limited rescue

- Launchpad owner cannot rescue WETH backing `totalRealQuote` or any ungraduated market token.
- Escrow owner cannot rescue any asset backing `totalOwed`.
- Locker LP has no withdrawal interface.

### Pull-based claims

Fee claims pay only `msg.sender`; no caller can redirect another account's entitlement. State is cleared before transfer.

### Ownership permanence

Launchpad, escrow, and buyback treasury use two-step ownership and disable renunciation. Locker has no administrator. The contracts are not upgradeable.

## Reentrancy and external-call ordering

| Path                                      | Protection and ordering                                                                                                          |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Launch, buy, sell, graduate               | `nonReentrant`; accounting effects precede external transfers/calls; transaction rollback restores effects on failure            |
| Escrow distribute, claim, rescue; buyback treasury convert and buyback | `nonReentrant`; liabilities are verified or updated before transfers                                                             |
| Swap adapter `swapExactIn`                | `nonReentrant`; validates pool, deadline, and minimum output before moving caller input directly into the pool |
| Locker claim                              | No reentrancy guard; pool is a trusted dependency, registration is immutable, and forwarding must be backed before escrow credit |
| Token transfer hook                       | No external calls; enforces lock locally                                                                                         |

The absence of a guard on the locker is coupled to the trusted pool implementation. Replacing that dependency with a callback-capable malicious adapter is outside the configured security model.

## Adversarial and failure cases

| Scenario                                             | Intended behavior                                                                                                                                                                  | Evidence                                                   |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Final fill would have zero rounded fee               | Allowed only for the complete final fill, preventing a wedged curve                                                                                                                | CurveMath unit tests                                       |
| Trader oversells                                     | Checked `held` subtraction or quote-reserve validation reverts                                                                                                                     | Trade and math tests                                       |
| Market remains sold out without graduation           | Abort available after seven days; next sell aborts inline                                                                                                                          | Abort tests                                                |
| Guardian pauses                                      | Launch and buy revert; sell and lifecycle exits continue                                                                                                                           | Admin/trade/abort tests                                    |
| Third party creates empty pool                       | Graduation reuses it; the stored graduation observation count keeps its empty observations out of every buyback TWAP                                                               | Graduation and escrow TWAP regression tests                |
| Pre-created pool with zeroed TWAP observations       | First buybacks skip until two live observation windows exist; credit and interval preserved                                                                                        | Escrow TWAP regression tests                               |
| Quote token with non-18 decimals                     | Deployment reverts `InvalidConfig`                                                                                                                                                 | Deploy unit test                                           |
| Wallet reaches its configured net curve cap           | Further buys revert or clamp to remaining capacity; a sell reopens capacity                                                                                                        | Wallet-cap unit tests                                      |
| Buy executes during launch seconds 0–4                | Time-dependent extra tax is included in spend and transferred directly to treasury                                                                                                 | Launchpad trade tests                                      |
| Curve token mis-sent to the launchpad while locked   | Reverts `Locked`: only the launchpad itself (buys, sell settlement, graduation) can move tokens to its address, so tokens cannot be stranded and burned with the graduation buffer | Token transfer-lock regression tests                       |
| Aborted market never graduates | Its WETH buyback share remains in the shared CURVE budget and can be spent after CURVE activation | Treasury custody tests |
| Unsynced pool donation                               | Skimmed before seeding                                                                                                                                                             | Graduation/rescue tests                                    |
| Synced WETH donation                                 | Matched at closing price while buffer permits; excess raises opening quote-per-token price and is not recovered through graduation                                                 | Unit and fork graduation tests                             |
| Pool has existing LP                                 | Graduation reverts `PoolUsed`                                                                                                                                                      | Graduation tests                                           |
| Pool has synced market tokens                        | Graduation reverts `PoolUsed`                                                                                                                                                      | Graduation tests                                           |
| Pool reserve update does not match intended seed     | Graduation reverts `MintMismatch`                                                                                                                                                  | Enforced in production; mocked integration behavior tested |
| Stray transfer to LP locker                          | Not attributed because claims use pool return values                                                                                                                               | Locker tests                                               |
| Fee credited without prior transfer                  | Escrow reverts `Unbacked`                                                                                                                                                          | Escrow tests                                               |
| Buyback lacks observations                           | Returns zero and preserves interval/credit                                                                                                                                         | Escrow tests                                               |
| TWAP call fails                                      | Returns zero and preserves interval/credit                                                                                                                                         | Escrow tests                                               |
| Icarus is paused                                     | Buyback skips before WETH transfer; graduation still works                                                                                                                         | Unit and fork tests                                        |
| Small spot movement                                  | Buyback may execute within band                                                                                                                                                    | Escrow tests                                               |
| Sandwich/large spot divergence                       | Buyback skips                                                                                                                                                                      | Escrow tests                                               |
| Non-owner buyback called before staleness             | Reverts `BuybackNotStale`; owner may call at any time                                                                                                                               | Buyback treasury tests                                     |
| Adapter quote or swap targets an unregistered or mismatched pool | Reverts before transferring input                                                                                                                               | Swap adapter unit tests                                    |
| Owner tries to rescue liabilities                    | Reverts                                                                                                                                                                            | Launchpad and escrow rescue tests                          |
| Deployment nonce prediction shifts                   | Entire deployment reverts                                                                                                                                                          | Deployment unit tests                                      |
| Mainnet owner is an EOA                              | Deployment preflight rejects                                                                                                                                                       | Mainnet fork deployment test                               |

## Explicit non-properties and assumptions

Auditors should not infer the following guarantees:

- The deployment script does not attest WETH, Icarus, timelock, guardian, or treasury bytecode hashes.
- Icarus pool pair correctness, fee units, pause behavior, reserve reporting, observation math, and fee-return behavior are trusted external assumptions exercised by fork tests.
- The launchpad constructor checks that the quote token reports 18 decimals, but this does not attest its ERC-20 behavior or code identity.
- Fee-on-transfer and rebasing assets are unsupported.
- A quote-side donation cannot wedge graduation, but an initialized pool or synced market-token contamination intentionally can.
- The locker assumes a registered pool's other token is WETH; it does not independently compare the address.
- `graduate` verifies exact post-mint reserves but does not inspect the `mint` return value or assert locker LP balance on-chain.
- Mainnet owner, guardian, treasury, proposer, graduation target, and deployed Curveball addresses are not present in this snapshot.
- `previewBuy` and `previewSell` ignore pause and lifecycle state and are not execution guarantees.
- `previewBuy` does not apply the caller's wallet cap; use `previewBuyFor` for that address. The cap cannot limit a person who controls multiple wallets.
- The opening tax raises the price of immediate buys but cannot guarantee transaction ordering or prevent all sniping.
- Unexpected external-call failures in buyback revert; explicit observation, TWAP, pause, and spot-price conditions are non-reverting skips.

## Test coverage map

| Area                                                                   | Primary executable evidence                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| Constant-product formulas, rounding, drift, dust, split conservation   | `test/unit/CurveMath.t.sol`                                     |
| Clone initialization, lock, permit, burn, unlock                       | `test/unit/CurveToken.t.sol`                                    |
| Launch, deterministic address, snapshots, metadata, first buy | `test/unit/Launchpad.Launch.t.sol`                              |
| Buy/sell accounting, deadlines, slippage, isolation, held ledger       | `test/unit/Launchpad.Trade.t.sol`                               |
| Wallet cap and opening tax                                              | `test/unit/Launchpad.WalletCap.t.sol`, `test/unit/Launchpad.Trade.t.sol` |
| Timeout, sticky abort, re-sellout, regraduation                        | `test/unit/Launchpad.Abort.t.sol`                               |
| Pool seeding, orientation, donations, used pools, size margin          | `test/unit/Launchpad.Graduate.t.sol`                            |
| Bounds, roles, pause, two-step ownership                               | `test/unit/Launchpad.Admin.t.sol`                               |
| Surplus-only rescue                                                    | `test/unit/Launchpad.Rescue.t.sol`                              |
| Fee backing/split/claims, escrow rescue, and buyback custody             | `test/unit/FeeEscrow.t.sol`, `test/unit/CurveBuybackTreasury.t.sol` |
| Buyback TWAP, slippage band, and spend caps                            | `test/unit/FeeEscrow.t.sol`, `test/unit/FeeEscrow.TwapPoison.t.sol` |
| LP permanence, fee routing, stray balances                             | `test/unit/LpLocker.t.sol`                                      |
| Graduated exact-input swap adapter                                      | `test/unit/IcarusSwapAdapter.t.sol`                             |
| Deployment prediction and immutable wiring                             | `test/unit/Deploy.t.sol`                                        |
| Complete asset lifecycle                                               | `test/integration/Lifecycle.t.sol`                              |
| Stateful multi-market properties                                       | `test/invariant/Invariants.t.sol`, `test/invariant/Handler.sol` |
| Real WETH/Icarus lifecycle and donation/pause assumptions              | `test/fork/Lifecycle.fork.t.sol`                                |
| Live-network deployment policy                                         | `test/fork/Deploy.fork.t.sol`                                   |

## Verification scope

The coverage map identifies executable tests, not a fixed passing-test snapshot. Run the local Foundry suite against the current worktree before relying on it. Fork tests establish compatibility with configured external contracts only at their pinned states; they do not prove external bytecode or state cannot later change.

## Auditor review hotspots

The highest-value manual review paths are:

1. Curve rounding and sellout behavior across many partial trades.
2. Graduation against adversarial pre-created pool state and token orientation.
3. Escrow liability conservation across quote and market-token fee assets.
4. Buyback TWAP/spot comparison, pool-fee adjustment, and transfer-before-swap ordering.
5. Historical `held` accounting versus reserve distribution after transfers.
6. Immutable deployment address prediction and authority preflight assumptions.
7. External Icarus pair correctness and the locker/launchpad reliance on it.
