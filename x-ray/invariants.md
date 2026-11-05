# Curveball Invariant Map

Verified on 2026-10-25 against `main` @ `bb0d8b0`. Sources: `contracts/contracts/*.sol` (CurveLaunchpad, CurveFeeEscrow, CurveToken, CurveHolderReserve, CurveLpLocker, libraries/CurveMath).

Legend: **Guard** = per-call precondition (not falsifiable globally, reference only). **Inferred** = global property derived from write-site analysis. **On-chain = Yes** means every write site of the constrained variable was verified to enforce it.

---

## §1 Enforced Guards (Reference)

#### G-1
- **Location**: `CurveLaunchpad.sol:53` (modifier `whenNotPaused`)
- **Predicate**: `if (paused) revert EnforcedPause();`
- **Purpose**: separates availability control (guardian) from value integrity — `paused` gates only `launch` and `buy`; never sell/graduate/claim/buyback.

#### G-2
- **Location**: `CurveLaunchpad.sol:170`
- **Predicate**: `if (uriLength == 0 || uriLength > MAX_URI_LENGTH) revert InvalidLaunch();`
- **Purpose**: bounds per-launch metadata cost; uri is emitted, never stored.

#### G-3
- **Location**: `CurveLaunchpad.sol:197` (`_createMarket`)
- **Predicate**: `if (taxBps > fees.taxCapBps || reserveTokens > MAX_RESERVE_TOKENS) revert InvalidLaunch();`
- **Purpose**: tax is capped by the admin snapshot; reserve tokens bounded so graduation always has its burn buffer.

#### G-4
- **Location**: `CurveLaunchpad.sol:213` (`_setFeeDefaults`)
- **Predicate**: `if (fees.feeBps > MAX_FEE_BPS || fees.taxCapBps > MAX_TAX_BPS || uint256(fees.creatorShareBps) + fees.buybackShareBps > BPS) revert InvalidConfig();`
- **Purpose**: fee policy bounds (≤200 fee, ≤50 tax cap, shares ≤100%); only calibratable for *new* launches (per-market snapshot).

#### G-5
- **Location**: `CurveLaunchpad.sol:216-218` (`_setGraduationTarget`)
- **Predicate**: `if (target < MIN_TARGET) revert InvalidConfig();` + `CurveMath.initialVirtualQuote` divisibility/uint128 check
- **Purpose**: raise target must be ≥0.01 ETH and divide the curve exactly.

#### G-6
- **Location**: `CurveLaunchpad.sol:222` (`_setGuardian`)
- **Predicate**: `if (guardian_ == address(0)) revert InvalidConfig();`
- **Purpose**: pause power can never be pointed at address(0) (permanent-freeze protection).

#### G-7
- **Location**: `CurveLaunchpad.sol:236` (`buy`)
- **Predicate**: `if (block.timestamp > deadline) revert Expired();`
- **Purpose**: caller-chosen expiry on buys (with `G-9`).

#### G-8
- **Location**: `CurveLaunchpad.sol:238-249` (`sell`, inline abort at `:243-245`)
- **Predicate**: `if (state == State.Ready && _expired(m)) state = _abort(m, token);` then `if (state != State.Trading && state != State.Aborted) revert NotTrading();`
- **Purpose**: sells are always open for curve tokens (Trading or Aborted); a stuck Ready market auto-aborts inline; invalidates `notExpired`-style deadlock.

#### G-9
- **Location**: `CurveLaunchpad.sol:261` (`sell`) and `:441-445` (`_buy`)
- **Predicate**: `if (q.net < minOut) revert Slippage();` / `if (b.tokensOut < minOut) revert Slippage();`
- **Purpose**: caller-chosen minimums on both directions.

#### G-10
- **Location**: `CurveLaunchpad.sol:293` (`graduate`)
- **Predicate**: `if (state != State.Ready && (state != State.Aborted || vT != SUPPLY - CURVE_SUPPLY)) revert NotReady();`
- **Purpose**: graduation only from Ready, or from Aborted when the curve is (again) fully sold out.

#### G-11
- **Location**: `CurveLaunchpad.sol:302` (`graduate`)
- **Predicate**: `if (tokenReserve != 0) revert PoolUsed();`
- **Purpose**: a pre-created pool with outstanding LP can never be commandeered for graduation.

#### G-12
- **Location**: `CurveLaunchpad.sol:316` (`graduate`)
- **Predicate**: `if (tokenReserve != tokensToPool || quoteReserve != quoteInPool) revert MintMismatch();`
- **Purpose**: post-`mint` reserves must exactly equal what graduation seeded — catches any fee/rebasing/skim divergence.

#### G-13
- **Location**: `CurveLaunchpad.sol:330` (`abortGraduation`)
- **Predicate**: `if (m.state != State.Ready || !_expired(m)) revert NotAbortable();`
- **Purpose**: 7-day timeout gate on abandoning a sold-out graduation.

#### G-14
- **Location**: `CurveLaunchpad.sol:364` (`rescue`, quoteToken branch)
- **Predicate**: `if (amount > IERC20(asset).balanceOf(address(this)) - totalRealQuote) revert NotRescuable();`
- **Purpose**: rescue can never touch quote owed to curve sellers. **The launchpad-solvency guard.**

#### G-15
- **Location**: `CurveLaunchpad.sol:367-369` (`rescue`, other-asset branch)
- **Predicate**: `if (state != State.None && state != State.Graduated) revert NotRescuable();`
- **Purpose**: a token still on its curve is curve inventory and cannot be rescued; graduates/unrelated tokens can.

#### G-16
- **Location**: `CurveLaunchpad.sol:352` (`pause`)
- **Predicate**: `if (msg.sender != guardian) revert NotGuardian();`
- **Purpose**: guardian-only availability control.

#### G-17
- **Location**: `CurveFeeEscrow.sol:72` (`distribute`)
- **Predicate**: `if (msg.sender != launchpad && msg.sender != ICurveLaunchpad(launchpad).locker()) revert Unauthorized();`
- **Purpose**: only the launchpad or the LP locker can mint claims into the escrow.

#### G-18
- **Location**: `CurveFeeEscrow.sol:74` (`distribute`)
- **Predicate**: `if (asset != quoteToken && asset != token) revert InvalidAsset();`
- **Purpose**: fee credits are restricted to the quote token or the market's own token.

#### G-19
- **Location**: `CurveFeeEscrow.sol:76` (`distribute`)
- **Predicate**: `if (IERC20(asset).balanceOf(address(this)) < totalOwed[asset] + amount) revert Unbacked();`
- **Purpose**: credits must be backed by a balance the caller already transferred in. **Escrow-solvency guard.**

#### G-20
- **Location**: `CurveFeeEscrow.sol:119-123` (`buyback`)
- **Predicate**: `if (address(pool) == address(0)) revert NotGraduated(); if (last != 0 && block.timestamp < last + BUYBACK_INTERVAL) revert TooSoon(); if (balance == 0) revert NothingToBuy();`
- **Purpose**: buybacks need a pool, an elapsed interval, and a funded balance; other failure modes skip (see `E-3`).

#### G-21
- **Location**: `CurveFeeEscrow.sol:159` (`rescue`)
- **Predicate**: `if (amount > IERC20(asset).balanceOf(address(this)) - totalOwed[asset]) revert ExceedsSurplus();`
- **Purpose**: rescue only the surplus above all liabilities.

#### G-22
- **Location**: `CurveHolderReserve.sol:41-44` (`register`)
- **Predicate**: `if (msg.sender != address(launchpad)) revert NotLaunchpad(); if (amount == 0) revert InvalidAmount(); if (reserveOf[token] != 0) revert AlreadyRegistered(); if (IERC20(token).balanceOf(address(this)) < amount) revert Unbacked();`
- **Purpose**: reserve registration: launchpad-only, once, and backed by real tokens.

#### G-23
- **Location**: `CurveHolderReserve.sol:55` (`claim`)
- **Predicate**: `if (launchpad.poolOf(token) == address(0)) revert NotGraduated();`
- **Purpose**: reserve claims require graduation.

#### G-24
- **Location**: `CurveHolderReserve.sol:57` (`claim`)
- **Predicate**: `if (claimed[token][msg.sender]) revert AlreadyClaimed();`
- **Purpose**: one-time pro-rata claim per holder.

#### G-25
- **Location**: `CurveToken.sol:55-58` (`initialize`)
- **Predicate**: `if (_initialized) revert AlreadyInitialized();` + `if (nameLength == 0 || nameLength > MAX_NAME_LENGTH || symbolLength == 0 || symbolLength > MAX_SYMBOL_LENGTH) revert InvalidMetadata();`
- **Purpose**: clone can only be initialized once (constructor seals the implementation) with bounded metadata.

#### G-26
- **Location**: `CurveMath.sol:52-55` (`quoteBuy`)
- **Predicate**: `if (maxSpend == 0 || maxSpend > type(uint128).max) revert InvalidAmount(); if (remaining == 0) revert SoldOut();`
- **Purpose**: buy-input bounds; keeps vT×vQ additive within uint256.

#### G-27
- **Location**: `CurveMath.sol:60-63` (`quoteBuy`)
- **Predicate**: `if (b.tokensOut == 0) revert ZeroOutput();` + `if (feeBps != 0 && b.fee == 0 && b.tokensOut != remaining) revert DustTrade();`
- **Purpose**: no zero-output buys; dust rejected *except on the final fill* so a dust remainder can't wedge the curve short of sellout (the `15ad664` fix).

#### G-28
- **Location**: `CurveMath.sol:73-78` (`quoteSell`)
- **Predicate**: `if (amount == 0) revert InvalidAmount(); if (s.gross == 0) revert ZeroOutput(); if (s.gross > realQuote) revert InsufficientReserve(); if (feeBps != 0 && s.fee == 0) revert DustTrade();`
- **Purpose**: sell cannot draw more quote than the market holds; fee-rounding dust rejected.

## §2 Inferred (Single-Contract)

#### I-1
- **Type**: Conservation
- **Claim**: Per market, `virtualQuote == initialVirtualQuote + realQuote` while state ∈ {Trading, Ready, Aborted}.
- **Derivation**: Δ pairs in `_buy` (`vQ += curveQuote` and `realQuote += curveQuote` at `CurveLaunchpad.sol:447-448`) and `sell` (`vQ -= gross` and `realQuote -= gross` at `:252-254`); `virtualToken` moves are paired with `held` (`I-3`). Prose source: `CurveLaunchpad.sol:78-79`.
- **On-chain**: **Yes** — only `_buy`/`sell` write both variables, always in the same basic block with equal magnitude; `vQ0` set once in `_createMarket`.

#### I-2
- **Type**: Conservation
- **Claim**: `totalRealQuote == Σ realQuote over all markets` at all times.
- **Derivation**: `totalRealQuote += curveQuote` (`:449`) paired with per-market `realQuote += …` (`:448`); `totalRealQuote -= gross` (`:255`) paired with `realQuote -= gross` (`:254`); `totalRealQuote -= realQuote` (`:295`) paired with `realQuote = 0` (`:294`) at graduation. No write site touches one without the other.
- **On-chain**: **Yes**.

#### I-3
- **Type**: Conservation
- **Claim**: Pre-graduation, `Σ_account held[token][a] == SUPPLY − virtualToken`.
- **Derivation**: `_buy`: `vT -= tokensOut` paired with `held[caller] += tokensOut` (`:443,450`). `sell`: `vT += amount` paired with `held[caller] -= amount` (`:251,249`). Token supply minted = SUPPLY (`initialize`), and the transfer lock (`X-1`) means balances can only move via these paths.
- **On-chain**: **Yes**. Corollary: at graduation `Σ held == CURVE_SUPPLY`, which makes holder-reserve claims total exactly `reserveOf` (`I-12`).

#### I-4
- **Type**: Conservation / Bound
- **Claim**: `IERC20(quoteToken).balanceOf(launchpad) ≥ totalRealQuote` — the launchpad is solvent for all outstanding seller liabilities.
- **Derivation**: `totalRealQuote > 0` only accumulates inside `_buy` right after the buyer's `safeTransferFrom` of `curveQuote` (state written before transfer, but any transfer failure reverts the Δ); every `totalRealQuote` decrement is either a sell payout (`net ≤ gross ≤ per-market realQuote`, `G-28`) or the graduation transfer to the pool. Rescue is capped by `G-14`.
- **On-chain**: **Yes**. (This is the highest-signal invariant of the protocol.)

#### I-5
- **Type**: StateMachine
- **Claim**: Market state lattice: `Trading → Ready` (one-shot, only when `vT == SUPPLY−CURVE_SUPPLY`), `Ready → Graduated`, `Ready → Aborted` (only after 7-day timeout), `Aborted → (Graduated only when sold out again)`; Aborted is sticky (sells stay open, no reverse edge to Trading/Ready).
- **Derivation**: write sites `:452-455` (Trading→Ready sets `readyAt` only on Trading), `:293` (→Graduated), `:473-475` (`_abort`). No function ever writes `state = Trading` or `state = Ready` from Aborted.
- **On-chain**: **Yes**.

#### I-6
- **Type**: StateMachine (one-shot latches)
- **Claim**: `CurveToken._initialized` false→true (constructor seals implementation; test writes here), `CurveToken.unlocked` false→true (`:61`, no reverse), `CurveHolderReserve.claimed[token][account]` false→true (`:58`, no reverse).
- **On-chain**: **Yes** — each latch has exactly one write site.

#### I-7
- **Type**: Temporal
- **Claim**: Every sold-out curve resolves: `readyAt` set once at Trading→Ready; graduation runs permissionless immediately, or `abortGraduation`/inline-sell abort after `GRADUATION_TIMEOUT` (7 days). An Aborted curve can graduate whenever sold out again (without a new `readyAt`);
- **Derivation**: `readyAt` write sites: `:454` (only in the Trading→Ready branch — so an Aborted re-sellout never starts a second timer; consistent because abort is moot there). Time-based edges: `_expired` `:468-470`, `abortGraduation` `G-13`.
- **On-chain**: **Yes**.

#### I-8
- **Type**: Bound
- **Claim**: For every live market, `feeBps ∈ [0,200]`, `taxBps ∈ [0, taxCapBps]` with `taxCapBps ≤ 50`, and `creatorShareBps + buybackShareBps ≤ 10_000`.
- **Derivation**: guard lift from `G-3`/`G-4`. Write sites of `feeBps`/`creatorShareBps`/`buybackShareBps`: only `_createMarket` (from `feeDefaults`), itself only writable via guarded `_setFeeDefaults`; `taxBps` written only in `_createMarket` after `G-3`.
- **On-chain**: **Yes**.

#### I-9
- **Type**: Conservation
- **Claim**: For the quote asset, `totalOwed[quote] == Σ_account claimable[account][quote] + Σ_token buybackBalance[token]`. For a token asset, `totalOwed[token] == Σ_account claimable[account][token]` (buyback share is burned immediately, not warehoused).
- **Derivation**: `distribute` quote branch: `totalOwed += amount`, `claimable[creator] += toCreator`, `claimable[treasury] += toProtocol`, `buybackBalance += toBuyback` (`:85-92`). Token branch: only `toCreator + toProtocol` added to `totalOwed`, `toBuyback` burned (`:88-90`). `claim`: zeroes `claimable` and decrements `totalOwed` equally (`:101-102`). `buyback`: decrements `buybackBalance` and `totalOwed` equally (`:143-144`).
- **On-chain**: **Yes**.

#### I-10
- **Type**: Bound
- **Claim**: `totalOwed[asset] ≤ IERC20(asset).balanceOf(escrow)`; equivalently `Σ claimable[∗][asset] + Σ buybackBalance[token] ≤ escrow balance`.
- **Derivation**: `G-19` at every distribute; claims/buybacks move out at most the recorded liability; rescue capped by `G-21`.
- **On-chain**: **Yes**. (Escrow solvency.)

#### I-11
- **Type**: Conservation
- **Claim**: `reserveOf[token] == reserve token balance before claims`, and post-graduation claims are exactly pro-rata: for any account `a` holding `h = held[token][a]`, claim = `reserveOf * h / CURVE_SUPPLY`; total claims ≤ `reserveOf`.
- **Derivation**: `register` requires `balanceOf ≥ amount` (`G-22`, no other deposit path; no rescue); `claimable` formula (`:49-52`); at graduation `Σ held == CURVE_SUPPLY` (`I-3`), so `Σ claim = reserveOf * Σh / CURVE_SUPPLY = reserveOf` exactly (floor dust stays by design).
- **On-chain**: **Yes**.

#### I-12
- **Type**: Temporal / Bound
- **Claim**: Buyback pacing holds: `lastBuyback[token]` is set only after a non-skipped buyback, `Δ(lastBuyback) ≥ BUYBACK_INTERVAL`, and `Δ(buybackBalance) ≤ BUYBACK_CHUNK_BPS` of balance, capped at `BUYBACK_MAX_IMPACT_BPS` of pool quote reserve.
- **Derivation**: write sites `:141-144` (both written together in `buyback`, after `G-20`; skip paths write neither — `_skip` returns before the writes), chunk cap in `_chunk` (`:169-175`).
- **On-chain**: **Yes**.

#### I-13
- **Type**: Bound
- **Claim**: Curve token `totalSupply ≤ SUPPLY` and is non-increasing after `initialize` (only `_mint` in `initialize`; `_burn` in `burn` / `graduate` / escrow `buyback`).
- **Derivation**: `_mint` write sites: `CurveToken.sol:58-60` only (guarded `G-25`). `_burn` callers: any holder (`burn`, on own balance), launchpad at graduation, escrow at buyback (on its own received balance). Pre-graduation, an owner-burn does not desync `vT`/`held` (those move only via buy/sell), and graduation caps pool seeding by balance (`:308`).
- **On-chain**: **Yes** (supply is a bound; the burn-buffer math absorbs owner burns).

## §3 Inferred (Cross-Contract)

#### X-1
- **Type**: Conservation (Launchpad ↔ CurveToken)
- **Caller side**: Launchpad trusts `held[token][account]` as the exact token balance of every holder (`I-3`), using it to freeze reserves at graduation and to auto-abort sells inline.
- **Callee side**: `CurveToken._beforeTokenTransfer` (`:77-80`) reverts any transfer unless `unlocked`, `from == address(0)` (mint), or at least one side is the launchpad. So pre-graduation the only balance changes are launchpad-mediated buy/sell/mint/burn, keeping `balanceOf == held` for every non-launchpad account.
- **On-chain**: **Yes** — the lock is the enforcement; `buy` has no recipient (`:187-189`), `sell` pulls from `msg.sender` then credits curve-side (state-before-transfer, revert-safe).

#### X-2
- **Type**: Ratio (Launchpad ↔ Icarus pool)
- **Caller side**: `graduate` assumes the new pool opens at ≈ the curve-end spot: seeds `quoteInPool = realQuote + quoteReserve(donations)` and `tokensToPool = min(tokensFor(quoteInPool, vT, vQ), burn buffer)` (`:305-312`).
- **Callee side**: Icarus `mint`/`skim` (`:300-314`), verified external source on file (`deployments/4153/icarus-Pool.sol`). `G-11` forbids commandeering an LP-issued pool; `G-12` re-checks reserves after mint.
- **Claim**: Opening price within design bounds of curve-end spot. **On-chain**: **No** — the *exact* "no donation premium" form is violated by design when donations exceed the burn buffer (documented in ADR 0003: the pool opens higher, at the donor's expense, and `skim` sweeps the token side first). The bounded form (premium limited to (donation − buffer)/quote) holds given Icarus behaves per source.

#### X-3
- **Type**: Temporal / Ratio (Escrow ↔ Icarus pool)
- **Caller side**: `buyback` compares spot `getAmountOut` (with fee) against the fee-adjusted 2-window TWAP `quote()` (fee-free) with a 1% band, and caps the chunk at 0.25% of pool quote reserve (`:132-143`, `:169-175`).
- **Callee side**: `pool.quote(tokenIn, amountIn, granularity)` semantics (must have `observationLength() > granularity`, else `FewObservations` skip) and `pool.sync()` behavior.
- **Claim**: Buyback output stays within 1% of fee-adjusted TWAP; per-event extractable sandwich bounded by the impact cap. **On-chain**: **No** — depends on Icarus TWAP correctness (verified source, not contract-enforced here); documented.

#### X-4
- **Type**: Setter-vs-invariant gap (Owner setter ↔ live-market usability)
- **Caller side**: `setGraduationTarget` (`G-5`) validates `target ≥ MIN_TARGET`, exact divisibility, and `vQ0 + target ≤ uint128.max` — but has **no economic upper bound**.
- **Callee side**: `_createMarket` computes `vQ0` from the current target for every new launch; `_buy`/`sell` store `vQ` as `uint128` via `SafeCast`.
- **Claim**: A target near the uint128 ceiling is *config-valid* yet leaves new curves with `vQ0` so large that the first meaningful buy overflows `uint128` — griefing launches until the owner changes it (`SafeCast` revert), and raises the practical risk of the "0.25% impact" assumptions being moot. **On-chain**: **No** — no write site enforces a usable upper bound. Owner is a timelocked multisig (trusted), so severity is low; a cheap fix (e.g. `target ≤ CURVE_SUPPLY * MAX` cap) removes the gap.

## §4 Economic

#### E-1
- **Claim**: Launchpad solvency for all pre-graduation seller obligations, via paired ledgers.
- **Derives from**: I-1, I-2, I-3, I-4, X-1.
- **On-chain**: **Yes** (all constituents Yes; this is the "double-entry bookkeeping holds" claim).

#### E-2
- **Claim**: Escrow solvency: every claim and buyback is fully backed by the escrow's balance; fees can never be over-distributed.
- **Derives from**: I-9, I-10, G-19, G-21.
- **On-chain**: **Yes**.

#### E-3
- **Claim**: Graduated markets self-resolve: every sold-out curve graduates or aborts within 7 days; buybacks are paced (≥1h), impact-capped (≤0.25% of quote reserve), and price-band-checked (≤1% from fee-adjusted TWAP), so per-buyback attacker extraction is bounded even with TWAP influence.
- **Derives from**: I-5, I-7, I-12, X-3.
- **On-chain**: **No** — the TWAP-band element depends on Icarus `quote()` (external); the pacing/impact elements are Yes.

#### E-4 (note)
- Differential between curve buy price and post-graduation pool price at the moment of graduation is bounded by `X-2` (closing-price seed) plus fees; buyers who exit via the curve at sellout pay at most the curve spot and the first pool trades open within the documented donor-premium bound. No separate invariant needed beyond I-1 + X-2; listed for auditor awareness.