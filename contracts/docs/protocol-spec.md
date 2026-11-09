# Protocol specification

This document specifies the observable behavior of the current contracts. “Must,” “may,” and “reverts” describe the implementation in this repository, not intended future behavior.

## Conventions

- `BPS = 10,000`.
- Token and quote amounts are integer base units. Production parameters use `ether` units because RISE WETH and the launched tokens use 18 decimals, and the launchpad constructor rejects any quote token whose `decimals()` is not 18.
- `S` is total token supply, `C` is curve supply, `vT` and `vQ` are virtual token and quote reserves, and `k = vT × vQ`.
- Integer division rounds down unless `ceil` or `ceilDiv` is stated.
- Transfers use `SafeERC20` except for internal mint/burn operations.
- Every transaction is atomic: any downstream revert restores earlier state changes and transfers.

## Protocol constants

| Constant                 |                Value | Meaning                                                                                |
| ------------------------ | -------------------: | -------------------------------------------------------------------------------------- |
| `SUPPLY` (`S`)           | 1,000,000,000 tokens | Supply minted by every market token                                                    |
| `CURVE_SUPPLY` (`C`)     |   800,000,000 tokens | Maximum inventory sold through the curve                                               |
| Non-curve supply         |   200,000,000 tokens | Inventory available for pool seed and graduation burn                                  |
| `walletCapBps`           |    1–10,000 bps | Immutable constructor parameter; the RISE deployment uses 500 bps (40 million curve tokens per wallet) |
| `MAX_FEE_BPS`            |              200 bps | Maximum curve trading fee                                                              |
| `MAX_TAX_BPS`            |               50 bps | Maximum creator tax cap                                                                |
| `MAX_LAUNCH_FEE`         |     0.01 quote token | Constructor bound; deployed value is immutable                                         |
| `MIN_TARGET`             |       4 quote tokens | Minimum configurable graduation target                                                 |
| `GRADUATION_TIMEOUT`     |               7 days | Delay before a `Ready` market can abort                                                |
| Name length              |           1–64 bytes | Enforced by token initialization                                                       |
| Symbol length            |           1–12 bytes | Enforced by token initialization                                                       |
| URI length               |        1–2,048 bytes | Enforced by launchpad; URI is event-only                                               |
| `STALENESS`              |                1 day | Public callers may trigger after this time since the last successful CURVE buyback |
| `BUYBACK_CHUNK_BPS`      |            2,500 bps | Nominal 25% of remaining buyback credit                                                |
| `MAX_IMPACT_BPS`         |               25 bps | Input cap of 0.25% of pool input reserves                                              |
| `SLIPPAGE_BPS`           |              100 bps | 1% tolerance below fee-adjusted TWAP                                                   |
| `TWAP_WINDOWS`           |                    2 | Last two Icarus observation intervals, each at least 30 minutes and potentially longer |

Deployment defaults are separate from hard bounds:

| Default                                       |                                                                    Value |
| --------------------------------------------- | -----------------------------------------------------------------------: |
| Launch fee                                    |                                                             0.00045 WETH |
| Curve fee                                     |                                                                   75 bps |
| Creator share of curve fee                    |                                                          5,000 bps (50%) |
| Buyback share of curve fee                    |                                                          2,500 bps (25%) |
| Creator-tax cap                               |                                                                   50 bps |
| Testnet graduation target for new deployments |                                                                   4 WETH |
| Mainnet graduation target                     | 4 WETH, pinned in the deployment script |

## Market data model

Each token maps to one `Market`:

| Field                 | Meaning                                                |
| --------------------- | ------------------------------------------------------ |
| `creator`             | Launch caller and recipient of creator fee/tax credits |
| `feeBps`              | Snapshotted fee rate charged on curve buys and sells   |
| `creatorShareBps`     | Snapshotted creator share of `fee`                     |
| `buybackShareBps`     | Snapshotted buyback share of `fee`                     |
| `taxBps`              | Creator-selected tax, bounded by the launch-time cap   |
| `state`               | `None`, `Trading`, `Ready`, `Graduated`, or `Aborted`  |
| `virtualToken`        | Current virtual token reserve                          |
| `virtualQuote`        | Current virtual quote reserve                          |
| `initialVirtualQuote` | Launch-time virtual quote reserve                      |
| `realQuote`           | Quote owed to this ungraduated curve                   |
| `readyAt`             | Timestamp of first sellout from `Trading`              |
| `pool`                | Graduated Icarus pool, otherwise zero                  |
| `launchedAt`          | Timestamp used to calculate the opening buy tax       |

Before graduation:

```text
sold = S − virtualToken
0 <= sold <= C
realQuote = virtualQuote − initialVirtualQuote
```

`held[token][account]` records net tokens bought from and sold back to the curve. It is not a transferable claim token and is not updated by post-graduation ERC-20 transfers.

## Curve math

### Starting virtual quote

For a requested graduation target:

```text
vQ0 = target × (S − C) / C
```

The multiplication must divide exactly by `C`; `target` must be nonzero; and `vQ0 + target` must fit `uint128`. With the fixed supplies, `vQ0 = target / 4`, so valid targets must satisfy the exact integer ratio. `CurveLaunchpad` additionally requires `target >= MIN_TARGET`.

### Buy quote

Inputs are current `vT`, `vQ`, available curve inventory or wallet capacity `remaining`, maximum all-in spend, fee rate, creator-tax rate, and current opening anti-snipe tax rate.

```text
budget = floor(maxSpend × BPS / (BPS + feeBps + taxBps + antiSnipeBps))
candidateTokens = vT − ceil(k / (vQ + budget))
```

If `candidateTokens <= remaining`:

```text
tokensOut = candidateTokens
curveQuote = budget
```

Otherwise the final fill clamps to remaining inventory:

```text
tokensOut = remaining
curveQuote = ceil(k / (vT − remaining)) − vQ
```

Then:

```text
fee = floor(curveQuote × feeBps / BPS)
tax = floor(curveQuote × taxBps / BPS)
antiSnipeTax = floor(curveQuote × antiSnipeBps / BPS)
spent = curveQuote + fee + tax + antiSnipeTax
```

Rules:

- `maxSpend` must be nonzero and at most `uint128.max`.
- `remaining` must be nonzero.
- `tokensOut` must be nonzero.
- The resulting all-in `spent` never exceeds `maxSpend`.
- If `feeBps` is nonzero and `fee` rounds to zero, the buy reverts as dust, except when it fills the entire remaining inventory.
- The final-fill exemption prevents an unfillable dust remainder immediately below sellout.
- Rounding preserves or increases the virtual constant product; it never advantages a round trip against the curve.

The opening anti-snipe rate is determined by whole seconds since `launchedAt`: 9,900 bps at second 0; 2,500 at second 1; 300 at second 2; 36 at second 3; 4 at second 4; and zero from second 5 onward. It applies only to buys, including an optional first buy in `launch()`, and its proceeds go directly to the protocol treasury. `antiSnipeTaxBps(token)` returns the current rate, or zero for an unknown token.

### Sell quote

```text
gross = vQ − ceil(k / (vT + amount))
fee = floor(gross × feeBps / BPS)
tax = floor(gross × taxBps / BPS)
net = gross − fee − tax
```

Rules:

- `amount` and `gross` must be nonzero.
- `gross` may not exceed the market's `realQuote`.
- A nonzero fee rate whose fee rounds to zero causes `DustTrade`.
- Selling more than the caller's `held` amount fails through checked arithmetic before tokens are transferred.

### Pool-seed token amount

At a virtual-reserve spot price:

```text
tokensFor(quoteAmount) = floor(quoteAmount × vT / vQ)
```

At exact sellout with no rounding drift, `vT = 200,000,000`, `vQ = 1.25 × target`, and `realQuote = target`, producing an ideal 160,000,000-token pool seed. The remaining 40,000,000 tokens burn at graduation. Real transactions can differ because of rounding and synced pool donations.

### Fee split

```text
creator = floor(fee × creatorShareBps / BPS) + tax
buyback = floor(fee × buybackShareBps / BPS)
protocol = fee + tax − creator − buyback
```

The creator receives all creator tax. The opening anti-snipe tax is separate and goes directly to treasury. Division remainder from the curve fee accrues to the protocol. The creator and buyback shares may sum to at most 100%.

## `CurveLaunchpad` specification

### Construction

The constructor requires nonzero treasury, quote token, Icarus factory, escrow, locker, and guardian addresses; inherited ownership construction governs the owner address. The quote token must report 18 decimals. `walletCapBps` must be in 1–10,000, and `MAX_WALLET_CURVE_TOKENS = CURVE_SUPPLY × walletCapBps / BPS` is immutable. Launch fee must not exceed 0.01 quote token. Fee defaults and graduation target must pass the bounds below.

Construction stores all dependency addresses and launch fee immutably, deploys and seals one `CurveToken` implementation, sets guardian/defaults/target, and emits their update events.

### `launch(meta, taxBps, maxSpend, minOut)`

Availability: permissionless, nonreentrant, and blocked while paused.

Preconditions:

- URI byte length is 1–2,048.
- Token name and symbol later pass token initialization bounds.
- `taxBps <= current feeDefaults.taxCapBps`.
- If `maxSpend == 0`, `minOut` must also be zero.
- Caller has approved the immutable launch fee and any optional first-buy WETH, including all buy taxes.

Effects:

1. Uses and increments the caller's launch nonce to deploy a deterministic clone.
2. Snapshots creator and current economic policy in a `Trading` market with `vT = S`, `vQ = initialVirtualQuote`, and zero real quote.
3. Transfers immutable launch fee directly to treasury.
4. Initializes the clone and mints the full supply to the launchpad.
5. Emits `LaunchCreated`, including metadata URI.
6. If `maxSpend != 0`, executes `_buy` for the launch caller and returns its output.

All effects revert atomically if any later step fails.

### `predictToken(creator)`

Returns the deterministic address for `creator` at its current `launchNonce`. A successful launch consumes that nonce; a reverted launch does not.

### `buy(token, maxSpend, minOut, deadline)`

Availability: permissionless, nonreentrant, blocked while paused, allowed only in `Trading` or `Aborted`.

- Reverts when `block.timestamp > deadline`; equality is valid.
- Caps the output at the caller's remaining wallet capacity, then requires `tokensOut >= minOut`. A wallet at capacity cannot buy more; any unused `maxSpend` stays in that wallet.
- Updates reserves and liabilities before transfers.
- Transfers curve quote to launchpad and fee/creator tax directly to escrow, then records the split; transfers any opening anti-snipe tax directly to treasury.
- Transfers market tokens only to `msg.sender` and increments only that account's `held` ledger.
- When the last curve token sells from `Trading`, changes state to `Ready`, records `readyAt`, and emits `GraduationReady`.
- When the last curve token sells from `Aborted`, emits `GraduationReady` but preserves `Aborted`.
- Emits `Trade` with all-in `spent`, token output, fee, creator tax, opening anti-snipe tax, and post-trade virtual reserves.

### `sell(token, amount, minOut, deadline)`

Availability: permissionless to a token holder, nonreentrant, and not blocked by pause.

- Reverts when `block.timestamp > deadline`; equality is valid.
- If state is `Ready` and the seven-day timeout has elapsed, first changes state to `Aborted` and emits `GraduationAborted`.
- Proceeds only in `Trading` or `Aborted`.
- Requires quoted `net >= minOut` and sufficient `held` amount, token allowance, and curve quote reserve.
- Decreases `held`, which reopens that wallet's buy capacity, increases `vT`, decreases `vQ`, and decreases both real-quote liabilities by gross output.
- Pulls tokens to launchpad, sends net quote to seller, and transfers fee/tax to escrow before distribution.
- Emits `Trade` with net quote received, token input, fee, tax, and post-trade reserves.

### Buy and sell previews

`previewBuy` returns the economic quote without a wallet limit. `previewBuyFor(token, account, maxSpend)` applies that account's remaining cap, and `remainingWalletCapacity` exposes it directly. Both buy previews include the opening tax at the current timestamp. The first buy inside `launch()` uses the same cap and the second-zero opening rate. The limit applies only to curve purchases by an onchain address; graduated Icarus trades are unrestricted. It cannot identify or limit a person using multiple wallets.

These views run current curve math but deliberately ignore market state and pause. Math-level errors and checked-arithmetic errors may still revert; they are quotations, not guarantees that the corresponding state-changing call is currently allowed.

### Launchpad views

- `market(token)` returns the complete stored `Market` value.
- `predictToken(creator)` returns the creator's next deterministic clone address.
- `feePolicy(token)` returns the market's creator, creator share, and buyback share for escrow accounting.
- `poolOf(token)` returns the registered graduated pool or zero before graduation.
- `antiSnipeTaxBps(token)` returns the current opening buy tax rate.
- Public getters expose immutable dependencies/configuration, current defaults, guardian/pause state, aggregate liabilities, per-creator nonce, and per-account `held` values.

### `graduate(token)`

Availability: permissionless and nonreentrant; not blocked by launchpad or Icarus pause.

Precondition: market is `Ready`, or is `Aborted` with exactly all `C` curve tokens sold.

Effects and checks, in order:

1. Set state to `Graduated`, clear market `realQuote`, and subtract it from `totalRealQuote`.
2. Permanently unlock the token.
3. Discover or create the canonical volatile Icarus pool. Reject an existing pool with nonzero LP supply.
4. Record pool and call `skim(launchpad)` to remove unsynced balances.
5. Read reserves by orientation and reject nonzero synced market-token reserve.
6. Define `quoteInPool = realQuote + syncedQuoteReserve`.
7. Define:

   ```text
   tokensToPool = min(
       floor(quoteInPool × vT / vQ),
       S − C,
       launchpad token balance
   )
   ```

8. Transfer only `realQuote` WETH—the existing synced quote remains in the pool—and transfer `tokensToPool`.
9. Mint LP directly to the locker.
10. Re-read reserves and require exact equality with `tokensToPool` and `quoteInPool`; otherwise `MintMismatch`.
11. Record the pool's current observation count in the buyback treasury through the escrow's `markGraduated` call as the TWAP zero point.
12. Burn the launchpad's entire remaining market-token balance.
13. Register token/pool with the locker and emit `Graduated`.

Unsynced WETH is skimmed to launchpad surplus. Synced WETH is matched at the closing price while inventory permits; excess beyond the available token buffer raises the pool's opening quote-per-token price and is not recovered through graduation. Existing LP or synced market-token reserve is rejected.

Production ignores the return value from `pool.mint`. It verifies exact token/quote reserves afterward but does not independently assert nonzero LP output or query the locker LP balance; those Icarus semantics are integration assumptions exercised by fork tests.

### `abortGraduation(token)`

Permissionless and nonreentrant. Requires `Ready` and `block.timestamp >= readyAt + 7 days`. Sets `Aborted` and emits `GraduationAborted`. It does not alter reserves or liabilities.

### Administrative calls

- `setFeeDefaults`: owner-only. Requires `feeBps <= 200`, `taxCapBps <= 50`, and `creatorShareBps + buybackShareBps <= 10,000`. Affects future markets only.
- `setGraduationTarget`: owner-only. Requires at least 4 quote tokens and valid exact initial-reserve arithmetic. Affects future markets only.
- `setGuardian`: owner-only and nonzero.
- `pause`: guardian-only. Sets `paused = true`; it does not stop exit/liveness paths.
- `unpause`: owner-only. Sets `paused = false`.
- `renounceOwnership`: always reverts.
- Ownership transfer follows OpenZeppelin `Ownable2Step`.

### Launchpad rescue

Owner-only and nonreentrant:

- Quote token: amount may not exceed `balanceOf(launchpad) − totalRealQuote`.
- A known market token: rescuable only after `Graduated`.
- Unrelated assets: rescuable.

The function emits `Rescued`; transfer behavior remains subject to the asset contract.

## `CurveToken` specification

- The implementation constructor binds immutable `launchpad = msg.sender` and seals implementation storage.
- A clone may initialize exactly once, only through the bound launchpad.
- Initialization validates name and symbol byte lengths and mints exactly `supply` to the launchpad.
- Before unlock, only minting and transfers in which the launchpad is the sender, or a transfer to
  the launchpad in which the launchpad is the caller, are allowed; all other transfers revert
  `Locked`. That is: buys, sell settlement (the launchpad calls `transferFrom`), and graduation
  burns keep moving, while holder-to-holder transfers, holder burns, and any
  allowance/permit-based transfer between non-launchpad addresses — including a holder sending
  tokens directly to the launchpad itself — revert. This prevents curve tokens from being stranded
  in the launchpad of a locked market, where they would later be burned with the graduation buffer.
- `unlock` is launchpad-only and irreversible.
- After unlock, standard transfers and holder burns are enabled.
- Permit2 automatic infinite allowance is disabled.
- Solady derives the permit domain per clone from its address and name.

## Fee escrow and CURVE buyback treasury

`CurveFeeEscrow.distribute(token, asset, fee, tax)` accepts fees only from the launchpad or LP locker. It applies the market's snapshotted creator and buyback shares. Creator and protocol shares become pull claims backed by `totalOwed[asset]`; the buyback share transfers immediately to `CurveBuybackTreasury`. The five-second opening tax is transferred directly to the protocol treasury by the launchpad.

The buyback treasury holds WETH in one `quoteBudget` across all markets. Market-token LP fee shares are held in `tokenBudget[market]` and may be converted to WETH through that market's graduated Icarus pool by anyone. Conversion uses seeded-reserve TWAP observations, a 25% budget chunk, a 0.25% input-reserve cap, a 1% slippage band, and the factory pause check. Failed market-price conditions skip without spending.

The owner may call `setCurveToken` only once, after the factory market has graduated and its pool observation boundary was recorded. Until then, the treasury accumulates fees. Thereafter, the owner may call `buyback()` at any time to spend one guarded chunk of the shared WETH budget through CURVE's Icarus pool. Other callers may do so only when `block.timestamp >= lastBuyback + STALENESS`. Successful purchases burn only CURVE. Skips preserve the budget and do not update `lastBuyback`. Graduation inventory burns remain part of every market's normal lifecycle.

The escrow's `claim(asset)` pays only the caller's creator or protocol claim. Its rescue function is limited to balances beyond `totalOwed`. The buyback treasury has no withdrawal or rescue path for credited assets. Both contracts use two-step ownership and disable renunciation.

## `CurveIcarusSwapAdapter` specification

The separately deployed adapter provides exact-input WETH/market-token swaps after graduation. Its constructor requires contract code at the launchpad, quote-token, and Icarus-factory addresses, then stores those addresses immutably.

- `quoteExactIn(token, buy, amountIn)` requires nonzero input and returns the pool's current fee-inclusive `getAmountOut` estimate.
- `swapExactIn(token, buy, amountIn, minOut, deadline)` is nonreentrant and requires nonzero input and `minOut`, plus `block.timestamp <= deadline`. It checks the current output against `minOut`, transfers the input directly from caller to pool, swaps directly to the caller, and emits `SwapExecuted`.
- `buy = true` swaps WETH for the market token; `buy = false` swaps the market token for WETH. Neither call accepts a recipient or arbitrary pool.
- Both calls reject zero/quote-token market addresses, a paused Icarus factory, a missing or noncanonical volatile pool, or a pool whose token pair differs from the market token and quote token. The pool must match both `launchpad.poolOf(token)` and `factory.getPool(token, quoteToken, false)`.
- The quote is an estimate; reserve, fee, and pause changes before execution may change the result or cause a revert. The adapter has no inventory custody or withdrawal function.


## `CurveLpLocker` specification

- Constructor fixes launchpad and escrow forever.
- Only launchpad may register a pool; each pool may be registered once.
- No function can withdraw or transfer LP principal.
- Anyone may call `claim(pool)` for a registered pool.
- The locker calls `claimFees`, interprets returned amounts by `token0` orientation, and treats the other asset as quote.
- Each nonzero returned amount is transferred to escrow before `distribute(token, asset, amount, 0)`.
- Stray asset balances are not credited because accounting uses returned amounts rather than balance differences.
- Emits `PoolRegistered` and `LpFeesClaimed`.

Correct asset attribution relies on the trusted factory returning the canonical token/quote pool; the locker does not independently compare the other token with launchpad's configured quote token.

## State and pause matrix

| Operation             |             Trading |                                             Ready |                  Aborted |           Graduated |  Blocked by launchpad pause? |
| --------------------- | ------------------: | ------------------------------------------------: | -----------------------: | ------------------: | ---------------------------: |
| Launch new market     |                 n/a |                                               n/a |                      n/a |                 n/a |                          Yes |
| Buy                   |                 Yes |                                                No | Yes, if inventory exists |                  No |                          Yes |
| Sell                  |                 Yes | No before timeout; aborts and sells after timeout |                      Yes |                  No |                           No |
| Explicit abort        |                  No |                                     After timeout |                       No |                  No |                           No |
| Graduate              |                  No |                                               Yes |          Only at sellout |                  No |                           No |
| LP fee claim          |                 n/a |                                               n/a |                      n/a |                 Yes |                           No |
| Fee claim             | Any accrued balance |                               Any accrued balance |      Any accrued balance | Any accrued balance |                           No |
| Buyback               |             No pool |                                           No pool |                  No pool |                 Yes | No; Icarus pause causes skip |

## Custom events

| Module    | Events                                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launchpad | `LaunchCreated`, `Trade`, `GraduationReady`, `GraduationAborted`, `Graduated`, `FeeDefaultsUpdated`, `GraduationTargetUpdated`, `GuardianUpdated`, `Rescued`, `Paused`, `Unpaused` |
| Token     | `Unlocked` plus inherited ERC-20 events                                                                                                                                            |
| Escrow    | `FeeAccrued`, `FeeClaimed`, `Rescued`                                                                                                           |
| Buyback treasury | `Funded`, `Converted`, `CurveTokenSet`, `BuybackBurned`, `SwapSkipped` |
| Locker    | `PoolRegistered`, `LpFeesClaimed`                                                                                                                                                  |
| Swap adapter | `SwapExecuted` |

`Trade.quoteAmount` is all-in spend for a buy and net receipt for a sell. `Trade.antiSnipeTax` is nonzero only on an opening buy. The URI is not stored in contract storage; it is emitted in `LaunchCreated` and also remains visible in launch transaction calldata.

## Custom errors

| Module     | Errors                                                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Launchpad  | `InvalidConfig`, `InvalidLaunch`, `NotTrading`, `Slippage`, `Expired`, `NotReady`, `NotAbortable`, `PoolUsed`, `MintMismatch`, `NotGuardian`, `EnforcedPause`, `RenounceDisabled`, `NotRescuable` |
| Curve math | `InvalidTarget`, `InvalidAmount`, `SoldOut`, `ZeroOutput`, `DustTrade`, `InsufficientReserve`                                                                                                     |
| Token      | `NotLaunchpad`, `AlreadyInitialized`, `InvalidMetadata`, `Locked`                                                                                                                                 |
| Escrow     | `Unauthorized`, `InvalidAsset`, `Unbacked`, `ExceedsSurplus`, `RenounceDisabled`                                                                                  |
| Buyback treasury | `Unauthorized`, `InvalidMarket`, `InvalidTarget`, `AlreadySet`, `NotReady`, `BuybackNotStale`, `NothingToSpend`, `RenounceDisabled`                                                         |
| Locker     | `NotLaunchpad`, `AlreadyRegistered`, `UnregisteredPool`                                                                                                                                           |
| Swap adapter | `InvalidConfig`, `InvalidTrade`, `PoolUnavailable`, `PoolMismatch`, `PoolPaused`, `Slippage`, `Expired` |
| Deployment | `AddressPredictionMismatch`, `WiringMismatch`, `UnsupportedChain`, `Preflight`                                                                                                                    |

Inherited OpenZeppelin, Solady, `SafeERC20`, arithmetic-panic, and external dependency reverts remain possible and are not replaced with protocol-specific errors.
