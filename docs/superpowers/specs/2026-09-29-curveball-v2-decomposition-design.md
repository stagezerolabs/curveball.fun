# Curveball V2 — Contract Decomposition & Icarus Integration Design

> **Status:** Approved design — pending user review of this spec (2026-09-29).
> **Scope:** In-place replacement of the live RISE Testnet `CurveballLaunchpad` monolith with an
> 11-subsystem decomposed contract set, Pons V2 economics, Icarus as the graduation venue.

## 1. Goal, context, success criteria

### Goal

Decompose the current live `CurveballLaunchpad` monolith into the 11-subsystem architecture
already sketched in `contracts/contracts/setup.md`, add full Pons V2 economics (quote-denominated
fees, per-launch fee-policy snapshots, fee escrow, creator tax, buyback vault), implement Pons-style
two-phase graduation, and keep Icarus (RISE Testnet factory `0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9`)
as the post-graduation venue.

### Context (what exists today)

- **Live monolith on RISE Testnet (chainId 11155931):** `CurveballLaunchpad` at
  `0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E`, `LpLocker` at `0xFC301f5349EB1ee9F12E8d6d446Ce5e526984782`,
  `MemeToken` (fixed-supply ERC-20 with pre-graduation transfer lock), verified Icarus factory integration,
  25/25 Foundry tests, 5 Echidna properties, security review in `docs/security/`.
- **Current economics (minimal):** no trading fees on the curve; post-graduation Icarus pool fees
  (volatile 30 bps) claimed via `LpLocker.claim()` and split creator 50% / treasury 50%.
- **Current graduation (single-call):** on buy-to-full, graduation runs immediately; on failure the
  market goes `pending`, sells stay open, later buy-to-full retries.
- **Icarus surface (verified):** factory (`getPool/createPool/isPool/implementation/isPaused/pauser/
  feeManager/voter/volatileFee/stableFee/unstakedFee/MAX_FEE`), pool (`token0/token1/totalSupply/
  getReserves/mint/skim/claimFees`, plus `getAmountOut/swap` from fork tests). **No custom after-swap
  hook registry** — the Pons Uniswap V4 hook concept cannot be literally replicated.

### Success criteria

1. All 11 subsystems compile under Solidity 0.8.24 / Foundry with per-contract
   `DeployedBytecode` under EIP-170's 24,576-byte cap.
2. The full lifecycle passes against a fresh RISE Testnet fork: launch → curve trade → `graduate()`
   → `createGraduatedPool()` → swap → hook fee claim → escrow/vault credit.
3. The 25 existing unit tests are ported (not deleted); new suites cover fees, escrow, buyback
   vesting, two-phase graduation, and hook delta accounting; all pass.
4. Echidna properties S1–S8 (Section 6) pass.
5. SDK, indexer, and API are repointed at the V2 surface; deployment records updated.
6. Deployment remains a human-gated step via the existing `CONFIRM_*` + encrypted-keystore discipline.

## 2. Architecture (Approach 1 — registry-first, per-launch satellites)

### Contract map

```
SINGLETONS (deployed once, protocol-controlled)        PER-LAUNCH (deployed per market)
─────────────────────────────────────────────         ─────────────────────────────
CurveLaunchFactory        coordinator/registry          CurveLauncherToken    fixed supply → curve
CurveLaunchDeployer       deploys per-launch set        CurveBondingCurve     phantom-reserve AMM + fees
CurveGraduationGuard      pre-flight validation
CurveGraduationExecutor   Icarus pool creation
LpLocker                  permanent LP jail
CurveMemeHook             pool-fee claim + split
CurveFeeEscrow            fee ledger + claims
CurveBuybackVault         sweep + vest
CurveLaunchAndBuy         atomic launch+buy wrapper
```

Rationale: per-launch deployment is only genuinely needed for the token and curve (their addresses
are the market identity). Fee machinery, graduation, and locking are shared services keyed by
launch/token — singletons keep deployment gas and audit surface small while satisfying the
bytecode cap structurally.

### Ownership & trust model

| Component | Owns | Privileges |
|---|---|---|
| Factory | protocol owner (Ownable2Step, as today) | set globals, invite gate, rescue, treasury routing |
| Token | factory | metadata-only; **no mint authority** — entire `supply` minted to its curve at deploy; pre-graduation transfers locked except curve ⇄ anyone |
| Curve | factory (registry) | none beyond trading — creator has zero special privileges in the curve |
| Guard / Executor / Hook | none | permissionless callers (keeper thesis) |
| Locker | none | LP in, never out |
| Escrow / Vault | none | permissionless claim/sweep, recipients fixed at launch |

The deployer's only job is `new CurveLauncherToken{salt}(...)` + `new CurveBondingCurve{salt}(...)`.
**Creator ≠ mint authority** holds structurally.

### Two-phase graduation state machine

```
TRADING ──curve sold out──▶ GRADUATABLE
                              │ anyone: factory.graduate(token)      [guard pre-flight]
                              ▼
                          DRAINED   ← factory holds token + quote reserves
                              │ anyone: factory.createGraduatedPool(token)  [guard pre-flight]
                              ▼
                          GRADUATED  (Icarus pool live, LP→locker, hook bound)
```

- `graduate()`: guard checks sold-out + pool not yet bound + Icarus factory unpaused; drains the
  curve (remaining token reserve + all quote) into factory reserves; market → `DRAINED`;
  emits `GraduationStarted`.
- `createGraduatedPool()`: guard re-checks reserves match curve exit state and the liquidity floor
  (`tokenL·quoteL > 1_000_000`); executor runs `getPool → createPool → skim(locker) → transfer
  token+quote → mint(locker) → locker.register`; emits `Graduated`.
- **Failure cannot strand:** pool-creation revert returns the market to `DRAINED` with reserves
  retained in the factory; retryable.
- The executor is the **only contract that ever calls Icarus pool creation** — one auditable file
  at the pool boundary.

## 3. Economics (Pons V2, quote-denominated)

### Per-launch fee-policy snapshot (immutable at launch)

```
feeBps               trading fee on the QUOTE leg of buys AND sells
creatorShareBps      share of fee → creator              (today: 5000)
buybackShareBps      share of fee → buyback vault         (new)
creatorTaxBps        optional ADD-ON fee → creator        (default 0)
protocol share       = 10_000 − creatorShare − buybackShare   (remainder, not configurable)
```

Global defaults (protocol-owned, snapshotted at launch so later policy changes never mutate a
live market — the Pons security invariant): `feeBps`, `buybackShareBps`, `creatorTaxBps` cap,
graduation params. Creator supplies at launch: name, symbol, URI, optional creator tax (≤ cap).

### Fee flows

- **Curve era:** every `buyTokens`/`sellTokens` computes `fee = quoteAmount · feeBps / 10_000` on
  the quote leg; remainder feeds `vT·vQ = k`. Same-transaction routing: creator share →
  `FeeEscrow(launch, creator)`, protocol share → `FeeEscrow(launch, treasury)`, buyback share →
  `BuybackVault(launch)` as quote. Fees are revenue immediately (no memecoin held by the fee path).
- **Pool era:** Icarus's native swap fee is claimed through `CurveMemeHook` using proven
  **balance-delta accounting** (ignore `claimFees()` return; pay only assets actually delivered).
  Hook splits per the *same* launch snapshot into Escrow/Vault. **`LpLocker.claim()` is deleted** —
  the hook is the pool's only registered fee claimer, bound once at graduation so no two contracts
  race the claim.

### Phantom reserve (unchanged from today)

`initialVQ` is virtual quote: `k = supply · initialVQ` sets the opening price with zero deposited
quote. `vQ = initialVQ + realQ` invariant must hold on every path (as today).

## 4. Buyback vault (Pons-style, bounded)

- Vault holds quote per launch; buys memecoin only via **price-tolerance-bounded sweeps**
  (`sweep()` permissionless, max-impact bound relative to current curve price).
- Sweep venue: the launch's **own curve** while trading; the launch's **own Icarus pool**
  post-graduation. Never another market's venue.
- Vesting: linear, per-lot, weighted-average vesting clock (configurable `vestingWindow`, default 5y).
  Vested tokens claimable by **protocol owner**; unvested are permanently locked until they vest.

## 5. EIP-170 budget (structural, pre-emptive)

Rough `DeployedBytecode` estimates (OZ 5.1, optimizer 200, shanghai): Factory ~13KB, Curve ~10KB,
Token ~8KB, Hook ~6KB, Escrow/Vault ~7KB each, Executor/Guard ~5KB each, Locker ~4KB,
Deployer ~4KB, LaunchAndBuy ~3KB. All comfortably under 24,576B with headroom for fee/vest features.
**Gate:** each contract must remain under cap at compile time; any contract trending over gets split
further rather than grown.

## 6. Security invariants (become Echidna properties + tests)

| # | Invariant | Enforced by |
|---|---|---|
| S1 | total minted = fixed supply; creator never mints | Token deploys full supply to curve; no mint authority |
| S2 | `vT·vQ = k` subject to fee & rounding | Curve math + fee-before-state-writes |
| S3 | quote asset identical across curve/pool/factory (verified WETH) | Immutable constructor pins |
| S4 | `GRADUATED ⇒` curve can never trade again | Curve phase lock, one-way |
| S5 | `GRADUATED ⇒` LP permanently inaccessible | Locker: register-only, no withdraw path |
| S6 | fees = creator + protocol + buyback within rounding | Escrow ledger + balance-delta claims |
| S7 | graduation can't strand assets; reserves survive `createGraduatedPool` reverts | DRAINED state retains custody in factory |
| S8 | creator ≠ authority: no mint, no snapshot mutation, no reserve withdrawal | Ownership split (Section 2) |

Additional boundaries carried from today's hardening: `nonReentrant` on buy/sell/graduate/
createGraduatedPool/claim/sweep; explicit `block.timestamp <= deadline` on trades; reserve-rescue
guards (cannot rescue escrowed/vested/locked assets); `SafeCast` at every `uint256 → uint128`
boundary; invitation gate (`invitedOrPublic`) and `openPublicLaunch()` retained.

## 7. Rollout plan (phases)

1. **Phase 1 — Contracts (TDD):** implement all **11 contracts** (10 new subsystem files + `LpLocker` refactor to drop `claim()`); port today's proven tests
   (phantom-reserve math, reentrancy, rescue guards, slippage) into per-contract suites; new suites
   for escrow splits, vesting clock, two-phase states, hook delta accounting, creator tax.
2. **Phase 2 — Fork lifecycle:** update `IcarusFactory.t.sol` + `MainnetLifecycle.t.sol` to the V2
   surface (launch → trade → `graduate()` → `createGraduatedPool()` → swap → hook claim) against
   live RISE Testnet Icarus; then the mocked local deployment.
3. **Phase 3 — Echidna:** port the 5 existing properties; add S1–S8.
4. **Phase 4 — Deploy + verify:** guarded `DeployV2` script (same `CONFIRM_*` + encrypted-keystore
   discipline), updated `verify-icarus` gate, new deployment record. **Human runs the actual deploy**
   (in-place replacement of `0x1A34768…`).
5. **Phase 5 — Read/chain integration:** SDK writes (`launch`, two-call graduation, claim/sweep),
   SDK reads switch to factory registry, indexer tracks new events (`GraduationStarted`, `FeeAccrued`,
   `FeeClaimed`, `BuybackExecuted`), API enrich surface.
6. **Phase 6 — Docs/security:** call-surface + inheritance diagrams, security review refresh, runbook.

## 8. Event surface (indexer contract)

Factory/curve/escrow/vault/locker emit: `LaunchCreated`, `Trade`, `GraduationStarted`,
`Graduated`, `GraduationDeferred`, `FeeAccrued`, `FeeClaimed`, `BuybackExecuted`,
`TokensRescued`, `NativeRescued`, `InvitationUpdated`, `PublicLaunchOpened`, plus locker
`PoolRegistered`.

## 9. Explicit non-goals / deferred

- No Icarus after-swap hook (impossible on the verified surface); pool fees flow via hook claim
  instead.
- No curve-side buyback sweeps against other launches.
- No migration of existing NominateBear market state (testnet; in-place replacement resets markets).
- No fee-on-transfer or rebasing quote assets (unchanged constraint — verified RISE WETH only).