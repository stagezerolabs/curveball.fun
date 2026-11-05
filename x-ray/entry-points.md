# Curveball Entry Points & Flow Paths

Verified against `main` @ `bb0d8b0`. Grep-verified signature scan: 18 externally-visible non-view functions in the five scope contracts (plus ERC20 surface on CurveToken and 4 functions on CurveHolderReserve/CurveLpLocker via interfaces). All facts below from code reading; threat analysis lives in `x-ray.md`.

## Protocol Flow Paths

Permissionless, value-moving flows and their prerequisite chains (destination ← writer of precondition):

**Launch**
`launch` ← `feeDefaults` snapshot (admin) ← `feeBps ≤ 200 / taxCapBps ≤ 50 / shares ≤ 100%` (setters, timelocked owner) ◄── `graduationTarget ≥ 0.01 ETH & divides exactly` (owner) ◄── `paused == false` (guardian) ◄── launchpad deployment (immutable wiring: treasury/quote/factory/escrow/locker/reserve).

**Curve buy**
`buy` ← market exists (from `launch`) ← state ∈ {Trading, Aborted} ◄── `deadline` & `minOut` (trader-chosen) ◄── `paused == false`.

**Curve sell**
`sell` ← state ∈ {Trading, Aborted} (Ready auto-aborts when expired) ← `held[caller] ≥ amount` (from earlier buys) ← `gross ≤ realQuote` (from prior buys on this market) ◄── `minOut` (trader-chosen).

**Graduation**
`graduate` ← state ∈ {Ready, or Aborted ∧ soldOut} ← `vT == SUPPLY − CURVE_SUPPLY` (from curve buys) ← pool with zero LP (`G-11`) ← `unlocked` flag on token (set by graduate itself) ← token balance ≥ `tokensToPool` (buys + burn buffer).

**Abort**
`abortGraduation`/inline-sell abort ← state == Ready ∧ `block.timestamp ≥ readyAt + 7 days` ← `readyAt` set at Trading→Ready.

**Reserve claim**
`claim` (HolderReserve) ← `poolOf(token) != 0` (graduated) ← not yet claimed ← `held[token][caller]` frozen at graduation.

**Escrow claim**
`claim` (FeeEscrow) ← `claimable[caller][asset] > 0` ← `distribute` from launchpad (curve fees) or locker (pool fees) ← backed balance (`Unbacked` guard).

**Buyback**
`buyback` ← `poolOf(token) != 0` ← `lastBuyback` older than 1h ← `buybackBalance > 0` ← TWAP-window availability ∧ not Icarus-paused ∧ spot within 1% band ← `distribute`(quote branch) ← pool fees via locker `claim`.

---

## Permissionless entry points (full detail)

### `CurveLaunchpad.launch(Metadata, taxBps, reserveBps, maxSpend, minOut)`
- **Caller**: any user (pays 0.001 WETH launchFee, immutable)
- **Params**: `meta` (user-controlled, bounded 1-64/1-12/1-2048), `taxBps` (user-controlled, `≤ taxCapBps` via G-3), `reserveBps` (user-controlled, `≤ MAX_RESERVE_BPS=400`), `maxSpend/minOut` (user-controlled; `maxSpend==0 ∧ minOut!=0` → revert)
- **Chain**: `_createMarket` → clone `CurveToken` → `CurveToken.initialize` → `HolderReserve.register` → (optional) `_buy`
- **State Δ**: creator `launchNonce[caller] += 1`; new market (vT=SUPPLY, vQ=vQ0, iVQ0=vQ0); optionally `Δ(totalRealQuote) +curveQuote`, `Δ(realQuote)`, `Δ(vT) −tokensOut`, `Δ(vQ) +curveQuote`, `Δ(held[caller])`
- **Value flow**: in: launchFee→treasury, (optional) quote→launchpad/escrow
- **Reentrancy guard**: nonReentrant

### `CurveLaunchpad.buy(token, maxSpend, minOut, deadline)`
- **Caller**: any user
- **Params**: token (user), maxSpend (user, `≤ uint128.max`), minOut, deadline (user; reverts if `now > deadline`)
- **Chain**: `_buy` → `CurveMath.quoteBuy` → fee escrow `distribute` when fee+tax ≠ 0
- **State Δ (per market)**: `vT −= tokensOut`; `vQ += curveQuote`; `realQuote += curveQuote`; `totalRealQuote += curveQuote`; `held[token][caller] += tokensOut`; possibly `state Trading→Ready` + `readyAt`
- **Value flow**: in: `spent = curveQuote + fee + tax` → launchpad (curveQuote) + escrow (fee+tax); out: `tokensOut` → caller
- **Reentrancy guard**: nonReentrant (state written before external calls)

### `CurveLaunchpad.sell(token, amount, minOut, deadline)`
- **Caller**: any holder (approval required)
- **Params**: amount (user), minOut (user), deadline (user)
- **Chain**: (inline abort if Ready∧expired) → `CurveMath.quoteSell` → fee escrow `distribute`
- **State Δ**: `held[token][caller] −= amount`; `vT += amount`; `vQ −= gross`; `realQuote −= gross`; `totalRealQuote −= gross`
- **Value flow**: in: `amount` tokens → launchpad; out: `net` quote → caller, fee+tax → escrow
- **Reentrancy guard**: nonReentrant
- **Note**: uses check-by-underflow for `held ≥ amount` (0.8 semantics); price bounded by `gross ≤ realQuote` (G-28).

### `CurveLaunchpad.graduate(token)`
- **Caller**: anyone (permissionless)
- **Chain**: `CurveToken.unlock` → `_freshPool` (get or create Icarus pool) → `pool.skim(launchpad)` → `_reserves` → transfer quote+token → `pool.mint(locker)` → `_reserves` (G-12) → `CurveToken.burn(leftover)` → `LpLocker.register(token, pool)`
- **State Δ**: `state → Graduated`; `realQuote = 0`; `totalRealQuote −= realQuote`; `m.pool = pool`; token `unlocked = true`; token supply −= burned
- **Value flow**: out: realQuote quote → pool; tokensToPool → pool; burned tokens destroyed; LP → locker (forever)
- **Reentrancy guard**: nonReentrant

### `CurveLaunchpad.abortGraduation(token)`
- **Caller**: anyone
- **Params**: token
- **State Δ**: `state → Aborted`
- **Chain**: none (event only)
- **Reentrancy guard**: nonReentrant

### `CurveFeeEscrow.claim(asset)`
- **Caller**: any account with a claim (creator, treasury contract)
- **State Δ**: `claimable[caller][asset] = 0`; `totalOwed[asset] −= amount`
- **Value flow**: out: amount → caller
- **Reentrancy guard**: nonReentrant

### `CurveFeeEscrow.buyback(token)`
- **Caller**: anyone (keeper or public)
- **Chain**: `pool.sync()` → `pool.quote(…)` → `pool.getAmountOut` → `pool.swap(escrow)` → `CurveToken.burn`
- **State Δ**: `lastBuyback[token] = now`; `buybackBalance[token] −= amountIn`; `totalOwed[quote] −= amountIn`; token supply −= burned
- **Value flow**: out: amountIn quote → pool; in: tokens → escrow (then burned)
- **Reentrancy guard**: nonReentrant

### `CurveHolderReserve.claim(token)`
- **Caller**: any holder (one-time)
- **State Δ**: `claimed[token][caller] = true`
- **Value flow**: out: `reserveOf * held / CURVE_SUPPLY` tokens → caller

### `CurveLpLocker.claim(pool)`
- **Caller**: anyone (collects fees for a registered pool)
- **Chain**: `pool.claimFees()` → `escrow.distribute(token, token, tokenAmount, 0)` + `distribute(token, quote, quoteAmount, 0)`
- **Value flow**: out: fees → escrow
- **Note**: LP itself can never move (no transfer function anywhere).

### `CurveToken.burn(amount)` (+ ERC20 transfer/approve/permit)
- **Caller**: any holder of own balance; transfer/approve pre-graduation blocked by `_beforeTokenTransfer` lock except to/from the launchpad.

---

## Role-gated entry points

| Contract | Function | Caller | Notes |
|---|---|---|---|
| CurveFeeEscrow | `distribute(token, asset, fee, tax)` | launchpad or locker | `G-17`; credits backed by `G-19` |
| CurveHolderReserve | `register(token, amount)` | launchpad | `G-22` |
| CurveLpLocker | `register(token, pool)` | launchpad | tokenOf one-time |
| CurveToken | `initialize(...)` | launchpad | one-shot (`G-25`) |
| CurveToken | `unlock()` | launchpad | one-shot latch |

## Admin entry points (owner / guardian)

| Contract | Function | Role | Whitelist/guard |
|---|---|---|---|
| CurveLaunchpad | `setFeeDefaults` | owner | `G-4` (new launches only) |
| CurveLaunchpad | `setGraduationTarget` | owner | `G-5` (no economic upper bound — see X-4) |
| CurveLaunchpad | `setGuardian` | owner | `G-6` |
| CurveLaunchpad | `unpause` | owner | — |
| CurveLaunchpad | `rescue(asset,to,amount)` | owner | `G-14`/`G-15` (surplus only) |
| CurveLaunchpad | `renounceOwnership` | owner | always reverts (disabled) |
| CurveFeeEscrow | `rescue(asset,to,amount)` | owner | `G-21` (surplus above totalOwed) |
| CurveLaunchpad | `pause` | guardian | instant; gates launch+buy only |

## View surface (not entry points)

`market`, `predictToken`, `previewBuy`, `previewSell`, `curveSupply`, `feePolicy`, `poolOf` (CurveLaunchpad); `claimable` (Escrow + HolderReserve), `buybackBalance`, `lastBuyback`, `totalOwed` (Escrow); `reserveOf`, `claimed` (HolderReserve); `tokenOf` (LpLocker); `name/symbol/balanceOf/…` (CurveToken ERC20, permit-enabled via solady).