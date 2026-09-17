# Smart Contract Vulnerability Scan — curveball.fun

**Scope:** `contracts/CurveballLaunchpad.sol`, `contracts/LpLocker.sol`, `contracts/MemeToken.sol`, `contracts/interfaces/IIcarus.sol`
**Out of scope:** `contracts/mocks/`, `contracts/test/`, the external Icarus V2 factory/pool implementation
**Compiler:** `0.8.24`, optimizer on (200 runs). Checked arithmetic by default; no `unchecked` or `assembly` blocks anywhere.
**Method:** cheatsheet sweep (grep + structural read), then per-candidate validation against the full reference files. Both material findings were reproduced with executable Solidity regression tests and helper mocks in `contracts/test/PoCIcarus.sol`.

---

## C-01 — LpLocker.claim pays out in a caller-chosen token, draining all locked LP

**File:** `contracts/LpLocker.sol` L34-L43
**Severity:** Critical
**Status:** FIXED — `contracts/LpLocker.sol`. Regression tests in `test/LpLocker.t.sol`.

**Description:** `claim` reads a fee _amount_ from a caller-supplied `pool` and then transfers that amount of two other caller-supplied token addresses out of the locker. Neither `pool` nor `token0`/`token1` is validated — `pool` is never checked against `creatorOf`/`factory.isPool`, and the token arguments are never checked against the pool's actual `token0()`/`token1()`. Any token the locker holds can be paid out against fees accrued in an unrelated, worthless one. Because the locker is the permanent custodian of every graduated market's LP, this drains the protocol's entire locked liquidity.

**Code:**

```solidity
function claim(address pool, address token0, address token1) external {
    (uint256 a, uint256 b) = IIcarusPool(pool).claimFees();   // pool unvalidated
    uint256 ca = a * creatorShareBps / 10_000;
    uint256 cb = b * creatorShareBps / 10_000;
    if (ca > 0) IERC20(token0).safeTransfer(creatorOf[pool], ca);  // token0 unvalidated
    if (a > ca) IERC20(token0).safeTransfer(treasury, a - ca);
    if (cb > 0) IERC20(token1).safeTransfer(creatorOf[pool], cb);
    if (b > cb) IERC20(token1).safeTransfer(treasury, b - cb);
    emit FeesClaimed(pool, ca, cb, a - ca, b - cb);
}
```

**Attack path (validated):**

1. Attacker launches and graduates a throwaway token. `_graduate` calls `locker.register(pool, m.creator)`, so `creatorOf[attackerPool] == attacker`. This is the ordinary creator flow, not a privileged action.
2. Attacker wash-trades their own worthless pool so it accrues `N` base units of memecoin fees. The cost is the swap fee on a token they minted; `N` is a raw 18-decimal unit count, so it is cheap to make large.
3. Attacker calls `claim(attackerPool, victimLpToken, victimLpToken)`. The locker transfers `N * creatorShareBps / 10_000` of the **victim's LP token** to the attacker and the remainder to the treasury.

The unit mismatch is what makes this free money: `N` units of a worthless memecoin fee authorise `N` units of an arbitrary valuable token. PoC output, with the shipped `creatorShareBps = 5000`:

```
locked LP: 2828427124746190097603
attacker stole: 1414213562373095048801
diverted to treasury: 1414213562373095048802
locker LP remaining: 0
```

The victim's LP position is fully drained; the attacker redeems their half for the underlying WETH and tokens.

**Secondary issues on the same line:** with `creatorShareBps == 0` (permitted by `require(share <= 10_000)`), `ca`/`cb` are always zero, so _any_ address can drain the locker to the treasury using a fabricated pool, with no graduation required. `creatorOf[pool]` is also never checked against `address(0)`, and `claimFees()` is an unguarded external call into an arbitrary contract made before all four transfers.

### Fix applied

`claim` now takes only `pool`, and three independent defences were added. Each is load-bearing — the first two are individually insufficient, since either alone still lets a caller name a pool they control and pay themselves in someone else's token:

1. **Registered pools only.** `require(creatorOf[pool] != address(0))` rejects fabricated pools, and closes the `creatorShareBps == 0` variant that needed no graduation at all.
2. **Payout tokens read from the pool.** `token0()`/`token1()` were added to `IIcarusPool` (both are confirmed present on the real Icarus pool — see `requiredPoolFunctions` in `scripts/verify-icarus.sh`) and are read on-chain instead of accepted as arguments.
3. **Amounts measured, not reported.** The payout is the `balanceOf` delta across `claimFees()`, so a pool can never authorise a payout larger than it actually delivered. This is the same bug class as the original finding — trusting a number returned by another contract — so it is closed rather than merely made unreachable.

```solidity
function claim(address pool) external nonReentrant {
    address creator = creatorOf[pool];
    require(creator != address(0), "unknown pool");
    IERC20 t0 = IERC20(IIcarusPool(pool).token0());
    IERC20 t1 = IERC20(IIcarusPool(pool).token1());
    uint256 before0 = t0.balanceOf(address(this));
    uint256 before1 = t1.balanceOf(address(this));
    IIcarusPool(pool).claimFees();
    uint256 a = t0.balanceOf(address(this)) - before0;
    uint256 b = t1.balanceOf(address(this)) - before1;
    ...
}
```

`LpLocker` also now inherits `ReentrancyGuard`, and the constructor rejects `treasury == address(0)` (which would otherwise brick every claim, since OZ's ERC20 reverts on transfers to the zero address).

**Behavioural notes for integrators:**

- `claim(address,address,address)` is now `claim(address)`. No caller existed outside the PoC, so nothing downstream breaks.
- Tokens that reach the locker via `_graduate`'s `pool.skim(address(locker))` are no longer distributable, because they are not part of any claim's delta. They were previously leakable through this bug. If sweeping them is desired, add an explicit owner-gated function rather than widening `claim`.

**Verification:** four regression tests in `test/LpLocker.t.sol`, each confirmed to fail under targeted mutation of the fix (removing the delta measurement, and removing the registered-pool check). The original theft PoC is now the first of these tests, asserting the victim's LP is untouched.

---

## M-01 — A market that cannot graduate freezes user funds permanently

**File:** `contracts/CurveballLaunchpad.sol` L104-L110, L113-L115, L130-L135
**Severity:** Medium
**Status:** FIXED — `contracts/CurveballLaunchpad.sol`. Regression tests in `test/GraduationPending.t.sol`.

**Description:** When the curve sells out, `buyTokens` attempts graduation in a `try/catch` and sets `m.pending = true` on failure. Both `buyTokens` and `sellTokens` require `!m.pending`, so a deferred market is fully halted. The only exit is `graduate()`, which re-runs the identical `_graduate` body — if the failure is persistent (Icarus factory paused, pool creation reverting, incompatible pool state) the market never recovers. Meme tokens are still non-transferable because `enableTrading()` only runs inside `_graduate`, so holders can neither sell back to the curve nor move their tokens, and `m.realQ` is stranded in the launchpad with no admin or user rescue path.

The deployment target's factory exposes `isPaused()` and `pauser()` (see `scripts/verify-icarus.sh`), so an upstream pause is a realistic trigger rather than a hypothetical one.

**Code:**

```solidity
if (m.sold == curveSupply) {
    try this.graduateExternal(token) {}
    catch (bytes memory reason) {
        m.pending = true;              // halts buys AND sells
        emit GraduationDeferred(token, reason);
    }
}
...
require(m.creator != address(0) && !m.graduated && !m.pending && amount <= m.sold, "inactive");
```

**PoC output:** with a factory whose `createPool` reverts, a market reaches `pending == true` with `realQ = 40e18` stranded; `sellTokens`, `buyTokens` and `graduate()` all revert and `tradingEnabled` stays `false`.

### Fix applied

Per `dos-revert.md`, failure of an external call must not be fatal to user funds. `sellTokens` no longer checks `!m.pending`, and a sell that takes the curve off its cap clears the flag:

```solidity
require(m.creator != address(0) && !m.graduated && amount <= m.sold, "inactive");
...
m.sold -= uint128(amount);
m.realQ -= uint128(out);
if (m.pending && m.sold < curveSupply) m.pending = false;
```

Why this is safe:

- **Sells stay solvent.** `m.vq == initialVQ + m.realQ` holds on every state transition, so `out = m.vq - newVq` can never exceed the market's own quote. The pre-existing `out <= m.realQ` check is the backstop.
- **The transfer works while pending.** `MemeToken._update` always permits `to == launchpad`, so holders can sell back even though `tradingEnabled` is still false.
- **Buys stay blocked.** `!m.pending` remains on `buyTokens`, so the curve cannot overshoot `curveSupply`.
- **`pending ⟹ sold == curveSupply` is preserved.** The flag is only ever set at the cap, and the `m.sold < curveSupply` guard means a zero-amount sell cannot clear it spuriously.
- **The market self-heals.** Once the flag clears, buying resumes, and the next buy that refills the curve retries graduation through the existing `try/catch`. No new admin surface was added.

**Verification:** five regression tests in `test/GraduationPending.t.sol`, including the full recovery path (defer → sell → reopen → upstream recovers → graduate) and a cross-market solvency check, since the launchpad commingles quote across markets. Both halves of the fix were confirmed to fail under targeted mutation (restoring `!m.pending`; removing the flag clear).

---

## L-01 — Unchecked `uint128` downcasts and unbounded constructor parameters

**File:** `contracts/CurveballLaunchpad.sol` L47-L55, L60, L92-L101, L122-L125
**Severity:** Low
**Status:** FIXED — checked casts and constructor bounds added; regression test in `test/Launchpad.t.sol`.

**Description:** Every write into the `Market` struct uses a raw `uint128(...)` cast, which truncates silently even under 0.8.x. `require(s > cs && vq > 0)` does not bound `supply` or `initialVQ` to `uint128`, so a deployment with `supply >= 2^128` would mint the full amount in `MemeToken` while `m.vt` silently truncates, corrupting the curve from block one. `uint128(quoteIn)` at L94 is the only attacker-controlled cast; it is not currently reachable (it requires transferring `2^128` quote units, and the graduation branch recomputes `used` correctly anyway), so this is a robustness rather than an exploitability finding.

**Code:**

```solidity
constructor(...) { require(s > cs && vq > 0); }   // no uint128 bound, no message
markets[token] = Market(msg.sender, uint128(supply), uint128(initialVQ), ...);
m.vq += uint128(quoteIn);
```

**Fix applied:** The constructor now rejects `s` and `vq` outside `uint128`, and every market-state narrowing conversion uses `SafeCast.toUint128()`. This makes an invalid deployment or an out-of-range trade revert rather than silently corrupting curve state.

---

## L-02 — Minimum-liquidity guard is overflow-safe

**File:** `contracts/CurveballLaunchpad.sol` L151
**Severity:** Low
**Status:** NOT A FINDING — the existing condition is correct.

**Resolution:** For positive integers, `quoteL > floor(1_000_000 / tokenL)` is equivalent to `tokenL * quoteL > 1_000_000`. The division form avoids an unnecessary multiplication overflow risk. With the deployed token liquidity, any nonzero WETH amount is necessarily above the pool's minimum product; that is mathematically valid, not a bypass. The existing regression test covers the low-liquidity failure path.

**Code:**

```solidity
require(tokenL > 0 && quoteL > 1_000_000 / tokenL, "liquidity too small to graduate");
```

---

## L-03 — Fee-on-transfer or rebasing quote token breaks `realQ` accounting

**File:** `contracts/CurveballLaunchpad.sol` L97-L101
**Severity:** Low
**Status:** DEPLOYMENT CONSTRAINT — deploy only with verified standard RISE WETH.

**Description:** `buyTokens` credits `m.realQ += uint128(used)` on the assumption that `safeTransferFrom` delivered exactly `quoteIn`. A fee-on-transfer or rebasing quote token delivers less, so the sum of `realQ` across markets exceeds the launchpad's actual balance and the last markets to sell or graduate revert on insufficient funds. `quote` is immutable and intended to be WETH, which makes this a deployment constraint rather than a live bug, but it is undocumented.

**Deployment constraint:** The only supported quote asset is verified RISE WETH at `0x4200000000000000000000000000000000000006`. The deployment operator must re-verify its code, name, symbol, decimals, and compatibility with the Icarus PoolFactory immediately before any broadcast. Fee-on-transfer and rebasing tokens are unsupported.

---

## L-04 — No deadline parameter on `buyTokens`/`sellTokens`

**File:** `contracts/CurveballLaunchpad.sol` L79, L113
**Severity:** Low
**Status:** FIXED — deadlines are enforced before token transfers; browser trades use a five-minute deadline.

**Description:** Both trade functions take `minOut`, so price slippage is bounded, but neither takes a `deadline`. A transaction stuck in the mempool can execute much later at a price that still satisfies a now-stale `minOut`. Per `transaction-ordering-dependence.md`, slippage protection is considered complete only with both parameters.

**Fix applied:** Both trade functions now receive `deadline` and reject expired transactions before touching market state or token balances. Regression tests cover both buy and sell expiry.

---

## I-01 — Informational

- **Donated tokens inflate graduation liquidity.** `MemeToken._update` permits transfers to the launchpad pre-graduation, and `_graduate` uses `balanceOf(address(this))` as `tokenL`. A holder can donate locked tokens into the graduation liquidity. It is a one-way gift with no accounting impact (`m.sold` is unchanged), but it means `tokenL` is not always `supply - curveSupply`.
- **View functions revert on unknown markets.** `quoteBuy`/`quoteSell` divide by `m.vq + quoteIn` / `m.vt + amount`, which panics for an unregistered token with a zero input. Frontends should guard.
- **`quoteBuy` does not report the refund.** On the final, curve-closing buy the caller is refunded `quoteIn - used`, but `quoteBuy` only returns `out`. The returned `out` is correct for `minOut` purposes; the quote cost is not derivable from it.
- **Missing revert strings.** `CurveballLaunchpad` L48, L138 and `LpLocker` L17 use bare `require(...)`.
- **LP is irrecoverable by design.** `LpLocker` has no LP withdrawal path. Assumed intentional; worth documenting, since C-01 was the only way LP could ever leave the contract.
- **Curve rounding leaves dust.** Both trade directions apply ceiling division to the surviving reserve, so a holder who sells their entire position back recovers `realQ` minus a wei or two, which stays in the market permanently. The direction is correct (rounding favours the protocol, which is what keeps it solvent) and the magnitude is negligible; recorded only so it is not mistaken for a leak. Measured in `test/GraduationPending.t.sol`.

---

## Discarded candidates

Recorded during the sweep and killed during validation:

| Candidate                                                                                                                                                                  | Why discarded                                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Graduation DoS by pre-minting LP into the pool (`totalSupply() == 0` guard, L146)                                                                                          | `MemeToken._update` locks all transfers to launchpad-only pre-graduation, so an attacker cannot supply the token side of a first mint. A one-sided mint reverts in Solidly-style pools. Guard is not attacker-reachable. |
| Reentrancy in `_graduate` (state written after `pool.mint` and `locker.register`)                                                                                          | Both entry points are `nonReentrant`; `graduateExternal` is gated on `msg.sender == address(this)`; `pool` is validated via `factory.isPool`. False positive per `reentrancy.md`.                                        |
| Round-trip curve arbitrage                                                                                                                                                 | Both `buyTokens` and `sellTokens` apply ceiling division to the surviving reserve, so `k` is non-decreasing on every trade. No extractable profit.                                                                       |
| `realQ` insolvency / `out <= m.realQ` blocking sells                                                                                                                       | The invariant `m.vq == initialVQ + m.realQ` holds across every state transition, so `out = m.vq - newVq` can never exceed `m.realQ`. The check is a redundant safety net.                                                |
| `used > quoteIn` over-crediting `realQ` on the curve-closing buy (L87-L92)                                                                                                 | `newVt_final >= ceil(k / (vq + quoteIn))` implies `newVq <= vq + quoteIn`, so `used <= quoteIn` always. Refund arithmetic is sound.                                                                                      |
| CREATE2 salt collision / market overwrite in `createToken`                                                                                                                 | Salt includes an incrementing per-creator nonce, and constructor arguments are part of the init code, so distinct launches cannot collide.                                                                               |
| `tx.origin`, `ecrecover`/signature replay, `delegatecall`, weak randomness, timestamp dependence, `msg.value` in loops, unbounded loops, unchecked low-level return values | No occurrences in production contracts (grep-confirmed). All token movement goes through `SafeERC20`.                                                                                                                    |

---

## Summary

| Severity | Count     |
| -------- | --------- |
| Critical | 1 (fixed) |
| High     | 0         |
| Medium   | 1 (fixed) |
| Low      | 0 (3 fixed, 1 deployment constraint) |
| Info     | 5         |

**C-01, M-01, L-01, and L-04 are fixed and covered by regression tests.** L-02 was a false positive: its division guard is exact and overflow-safe. L-03 remains a deployment constraint; only verified standard RISE WETH is supported.

**Test artifacts:** `test/LpLocker.t.sol` (C-01, 4 tests), `test/GraduationPending.t.sol` (M-01, 5 tests), `test/Launchpad.t.sol` (SafeCast and deadline regressions), and `test/fork/IcarusFactory.t.sol` (full Icarus lifecycle). Full suite: 21 passing when the RISE RPC is configured.

**On method:** every regression test here was mutation-checked — each defence was individually reverted and the suite confirmed to fail. Two tests did not initially catch their own mutation and were rewritten; a test that passes against the broken code is not a regression test.
