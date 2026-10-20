---
name: launchpad-solidity-review
description: Use when auditing CurveLaunchpad.sol, CurveFeeEscrow.sol, CurveLpLocker.sol, CurveHolderReserve.sol, CurveToken.sol, or CurveMath.sol for exploitable bugs — curve math and rounding, graduation seeding, the held ledger, escrow backing, rescue bounds, or the state machine. Also use when running Slither, Echidna/Medusa, or extending the Foundry invariant suite against Curveball.
---

# CurveLaunchpad Solidity review

The contracts are small (≈1,100 LOC) and heavily commented. Read all of them before
forming hypotheses — the comments state precise intent, and several look like bugs until
you read the adjacent `@dev` note. Your value is finding the gap between the stated
invariant and the code, not restating the comments.

Run `cube`-style order: baseline, then hypotheses, then targeted proof.

## Step 1 — establish a baseline, don't skip it

```bash
cd contracts && forge build && forge test
slither . --filter-paths "node_modules"
```

`forge test` is 138 passing tests including an invariant suite. A green suite is your
starting point, not your evidence. Slither emits ~20 mostly-Low findings; triage which
are real and say why the rest are noise. Do not pad the report with raw Slither output.

## Step 2 — the specific things worth attacking

Work through these. Each is a place where the intent is subtle enough to break.

### Curve math (`CurveMath.sol`)

Every rounding step is meant to favor the curve. Verify that claim rather than assume it.

- `quoteBuy`: `budget = maxSpend * BPS / (BPS + feeBps + taxBps)` — floor. Then
  `tokensOut = vT - ceilDiv(k, vQ + budget)`. Does the buyer ever get more tokens than
  their `maxSpend` should buy? Try small `maxSpend` against a large `vQ`.
- `quoteSell`: `gross = vQ - ceilDiv(vT*vQ, vT+amount)` — floor. Can a seller extract
  more quote than the curve should pay?
- `initialVirtualQuote`: requires `target * (S-C) % C == 0` exactly. What happens for a
  `graduationTarget` that is *just* off? Is the revert the only outcome, or can a weird
  target produce a `vQ0` that makes graduation impossible later?
- `tokensFor(quoteAmount, vT, vQ) = mulDiv(quoteAmount, vT, vQ)` — floor. Used at
  graduation to size the pool seed. Rounding *down* here means the pool opens with fewer
  tokens than the closing price implies. Is that exploitable by a donor?

### Graduation (`CurveLaunchpad.graduate`)

This is the highest-value function. It is permissionless and touches pool state.

- `UNLOCK FIRST` — `CurveToken(token).unlock()` happens before `_freshPool`. Why must it?
  What breaks if the order changed? (The comment says skim transfers the token.)
- `tokensToPool = min(tokensFor(quoteInPool, ...), min(S - C - reserveTokens, balanceOf(this)))`.
  The three-way min is where a donation can shift the opening price. Model the case where
  a donor pre-creates the pool and syncs a large WETH balance before graduation.
- `if (tokenReserve != 0) revert PoolUsed();` after `skim` — can an attacker front-run
  graduation by donating *tokens* to the pool? Remember the transfer lock: can any curve
  token reach the pool before unlock? Check `_beforeTokenTransfer` exemptions carefully —
  `from == launchpad || to == launchpad` are allowed, and `unlock` is permanent.
- `MintMismatch` check compares reserves to expected. Is the check complete for both
  orderings of `token0`/`token1`? Read `_reserves`.
- `burned = balanceOf(this)` — burns *everything* left. If an unrelated token were
  somehow held, this burns it. Can that happen? (`rescue` refuses to send curve tokens.)

### Escrow backing (`CurveFeeEscrow`)

- `distribute` requires `balanceOf(asset) >= totalOwed[asset] + amount`. This is the
  anti-double-credit check. Who can call `distribute`? Only the launchpad and the locker.
  Verify that gate cannot be bypassed, including via `ICurveLaunchpad(launchpad).locker()`
  returning something attacker-controlled.
- `claim` zeroes the claim *before* the transfer — correct ordering. Confirm.
- `buyback`: the comment claims every failure path skips without starting the interval so
  keepers don't loop on reverts. Enumerate the paths that *do* revert (`NotGraduated`,
  `TooSoon`, `NothingToBuy`) and check a keeper can't be wedged. Specifically: if
  `buybackBalance > 0` but the pool has no observations forever, does the balance get stuck?
- `_chunk` caps `amountIn` at `BUYBACK_MAX_IMPACT_BPS` of the quote reserve. If the cap
  *is* the binding constraint and the reserve shrinks, can `amountIn` become 0? Then
  `totalOwed[quoteToken] -= 0` and the swap is a no-op — wasted gas, or worse?
- The TWAP band: `minOut` derives from `pool.quote(...)`. Can an attacker manipulate the
  TWAP *within* the same block as the buyback to make a bad swap pass the band?

### The `held` ledger and holder reserve

- `held[token][buyer] += tokensOut` on buy, `-= amount` on sell. `sell` relies on
  `held >= amount` ("bounds vT + amount by SUPPLY"). Is the subtraction safe from
  underflow for every path? What about an `Aborted` market where buys resume?
- `CurveHolderReserve.claimable` freezes at graduation because `poolOf(token) != 0`
  becomes true. Is there any window where `held` changes *after* `poolOf` is set but
  before holders claim? (Transfers unlock — tokens can move, but `held` is the launchpad's
  ledger and does not follow transfers. Does the reserve follow the right wallet?)
- `register` requires `balanceOf(reserve) >= amount`. Fine at launch. Can it be called twice?

### `rescue` bounds

- Launchpad `rescue`: for `quoteToken`, checks `amount <= balance - totalRealQuote`. For
  any other asset, only allows `State.None` or `State.Graduated`. Confirm a `Trading`
  market's tokens truly cannot be rescued, including via a token address that is *also*
  quoteToken (aliasing), and that the subtraction cannot underflow if
  `balance < totalRealQuote`.
- Escrow `rescue`: `amount <= balance - totalOwed[asset]`. Same underflow question.

### State machine

- `Ready` + expired ⇒ `sell` aborts inline. `Aborted` + sold out ⇒ `graduate` works.
  In `Aborted`, `_buy` sets `Ready` only `if (state == State.Trading)` and emits
  `GraduationReady` unconditionally when sold out. Trace: can a market reach `Ready`
  with a *stale* `readyAt` from a previous cycle, letting a second abort happen too early
  or too late?
- Is `Aborted` truly sticky — can any path move it back to `Trading`?

## Step 3 — prove, don't speculate

Static reading produces hypotheses. Convert the important ones into evidence:

- **Foundry test** — write a focused test in `contracts/test/unit/`. Prefer this: it is
  fast, deterministic, and the reviewer can re-run it. A candidate finding without a
  reproducer is a question, not a finding.
- **Invariant extension** — if your hypothesis is "some accounting relationship can drift
  under fuzzing," add it to `Handler.sol`/`Invariants.t.sol` and run 256×64.
- **Echidna/Medusa** — available if installed; useful for the state machine and rounding.
- **`cast` against testnet** — to confirm a deployed value matches the recorded config in
  `deployments/11155931/curveball.json`.

Report a hypothesis you could *not* prove as an "unproven concern" with the exact reasoning
and what would settle it. That is honest and useful; inventing a exploit is not.
