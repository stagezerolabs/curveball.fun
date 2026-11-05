# Curveball — X-Ray Pre-Audit Report

- **Repository**: `curveball.fun` (monorepo: contracts, keeper, social service, frontend)
- **Analyzed branch**: `main` at `bb0d8b0d07352b667c296a412005e838434a4d37` (231 commits)
- **Scan date**: 2026-10-25 (local)
- **Core language**: Solidity 0.8.24 (Foundry 1.8.1, OZ 5.1.0, solady 0.1.26)
- **On-chain scope**: RISE EVM chain (mainnet 4153 / testnet 11155931), Icarus AMM (Aerodrome-style)
- **Prior reviews on file**: `docs/audits/dreadnode-2026-10-18/` (3 reports: offchain steps 1-2, security review, indexer reorg path)
- **Generated**: x-ray folder with `x-ray.md`, `entry-points.md`, `invariants.md`, `architecture.json`, `git-security-analysis.json`. The bundled SVG generator was not present in the installed skill; architecture.json is provided but `architecture.svg` was not produced.

## 1. Overview & Scope

Curveball is a **bonding-curve launchpad with automatic graduation into a volatile AMM (Icarus), a fee split/escrow, a TWAP-bounded buyback-and-burn engine, and a permanently-locked LP**. The on-chain core has been rewritten ("lean-v2", see ADR 0003); V1 files remain in git history only. An off-chain stack supports the frontend (social API + indexer + keeper).

The chain core's money model: `launch` clones a fixed-supply token (1,000,000), sells 800,000 on a virtual-reserve curve (`virtualToken * virtualQuote = k`), graduating a sold-out curve into a fresh volatile Icarus pool at the curve's closing price; the tokens not seeded are burned. Fees (≤ 200 bps fee + ≤ 50 bps creator tax per launch) flow to `CurveFeeEscrow` and split creator / protocol / buyback. The buyback buys the token from the graduated pool and burns it, paced at ≥ 1h and ≤ 0.25% of pool quote reserve. LP is locked forever in `CurveLpLocker`. Optional 0–4% holder reserve pays out pro rata at graduation.

**Scope table (by subsystem):**

| Subsystem | Files | nSLOC | Notes |
|---|---|---|---|
| Launchpad | `contracts/CurveLaunchpad.sol` | 476 | Singleton: launch, buy/sell, graduation, admin, rescue |
| Math | `contracts/libraries/CurveMath.sol` | 95 | CPMM quotes, fee split, initial virtual quote |
| Token | `contracts/CurveToken.sol` | 70 | EIP-1167 clone, transfer lock until unlock |
| Fee escrow | `contracts/CurveFeeEscrow.sol` | 157 | distribute / claim / buyback / rescue |
| Holder reserve | `contracts/CurveHolderReserve.sol` | 50 | register / pro-rata claim at graduation |
| LP locker | `contracts/CurveLpLocker.sol` | 48 | register / claim LP fees → escrow |
| Interfaces | `interfaces/ICurveLaunchpad.sol`, `ICurveSingletons.sol`, `IIcarus.sol` | — | Icarus surface (verified external source on file) |
| **On-chain total** | **6 contracts + 1 lib + 3 interfaces** | **~896** | excl. interfaces; OZ/solady vendored |
| Keeper | `keeper/graduation-keeper.mjs` (+ test) | 481+243 | Permissionless-tx relay: graduate/abort/buyback |
| Artwork API | `api/artwork.js` (+ test) | ~90 | Pinata upload, origin- and magic-byte-checked |
| Social backend | `services/social/` (not re-audited this pass) | ~2,500 est. | Prior Dreadnode review; 1 known Medium open (see §8) |
| DB | `packages/db/` (Drizzle/Supabase) | — | Projections only; covered by prior review |

Not in this pass's deep line-reading (covered by prior review): `services/social/src/*`, `packages/db/*`, frontend `src/`. Scanned for git/secret/config hygiene only.

## 2. Threat & Trust Model

### Actor table

| Actor | Entity | Capabilities (instant vs delayed) | Trust |
|---|---|---|---|
| Owner | OZ `Ownable2Step`; README mandates a TimelockController (proposer = multisig) | Instant: `setFeeDefaults` (bounds only, ≤200/50 bps), `setGraduationTarget` (≥ 0.01 ETH, must divide exactly), `setGuardian`, `unpause`, `rescue` (surplus only), `renounceOwnership` (disabled). Role transfer is 2-step. | High; all actions bounded by invariants; cannot extract owed balances or move LP |
| Guardian | non-timelocked multisig (per README) | Instant: `pause` (launch + buy only). | Availability only |
| Treasury | immutable Safe (per README) | Receives launch fee + protocol fee share. No contract-side power. | None needed |
| Creator | any wallet | Permissionless `launch` (pays 0.001 WETH); earns creator share + whole tax after graduation; claims via escrow. | User |
| Trader | any wallet | Permissionless `buy`/`sell`, `claim` (escrow, reserve). | User |
| Keeper | dedicated EOA | Sends only permissionless txs (graduate/abort/buyback). Key compromise → gas grief only, no funds. | Low |
| Icarus | external factory/pool | Pools, fees, TWAP, `swap`, `mint`, `claimFees`. FeeManager can divert up to half of LP fees to gauges (ADR 0003). | Trusted for liveness & fee integrity; not for price (buyback TWAP-band guarded) |

### Trust boundaries

- **Quote token (WETH 18-decimal, immutable)**: no native-ETH paths, no `receive`. Boundary enforced by SafeERC20 and by `distribute`'s `Unbacked` check.
- **Launchpad → escrow**: fees are `safeTransferFrom`-ed, then `distribute` records claims only up to the escrow's confirmed balance (`G-19`).
- **Launchpad → locker/reserve**: register is `msg.sender == launchpad`-gated; neither contract can move LP (locker has no rescue by design).
- **CurveToken transfer lock**: pre-graduation tokens can only move to/from the launchpad (mint, buy, sell). This makes `held` == real balances (`X-1`).
- **Launchpad → Icarus pool**: graduation deliberately ignores the Icarus pause (its pauser cannot force aborts); only buyback checks `isPaused`. Existing pool must have zero LP (`G-11`).
- **Users → contracts**: `buy` has no recipient — curve tokens only ever reach the payer. Slippage + deadline guards on buy/sell are caller-chosen.

### Pause coverage

Pausable: `launch`, `buy` (guardian). Deliberately never pausable: `sell`, `graduate`, `abortGraduation`, `claim`, `buyback`, `rescue`. Missing pause is by design and documented (ADR 0003); its consequence is folded into the Guardian compromise surface below.

### Centralization analysis (integrated)

- **Owner compromise / takeover**: cannot steal seller liabilities (`G-14`), escrow liabilities (`G-21`, escrow owner is 2-step too) or LP (locker immutable, no rescue). Real powers: grief new launches via `setGraduationTarget` near `uint128` ceiling (`X-4`), change fee policy for *future* launches only (snapshot per market), rotate guardian (then unpause self — needs timelock upstream anyway), rescue only surplus (`G-14`/`G-21` protect user funds). There is **no upgrade path** and **no proxy**; a compromised owner cannot modify code.
- **Guardian compromise**: freezes new exposure until owner unpauses. Cannot touch existing positions, sell path, graduation, claims, or buybacks.
- **Keeper compromise**: sends only permissionless market transactions; a stolen key can at worst burn keeper ETH on gas. The keeper has no special authority on-chain.
- **Icarus compromise**: its pause can stop buybacks (skip), its feeManager can divert LP fees (indexer alerts per ADR 0003), and its TWAP is the buyback oracle — bounded by the 0.25% impact cap and 1% slippage band (`E-3`).

### Protocol classification & threat profile

Type: **bonding-curve launchpad (virtual-reserve AMM) + fee/escrow/buyback engine + permanent LP lock**, hybrid of launchpad and AMM-fee accrual. Growth phase → liquidity. Money flows: ETH → curve tokens → ETH; fees → escrow → creator/treasury/buyback; graduation → pool + locked LP; reserve → pro-rata claims.

Distinctive risks for this type, in priority order:

1. **Curve accounting drift** (virtual/real reserve, `held`, `totalRealQuote`) — attacks target any write site that desynchronizes one ledger from another. Mitigated: every Δ is paired in the same basic block (`I-1`–`I-3`); all verifiable on-chain.
2. **Graduation manipulation** (donation to pre-created pool, skim, premature pool seeding) — mitigated by `G-11`/`G-12`; the residual donation-premium case is documented (buyer-side only, `X-2`).
3. **Buyback sandwich / TWAP manipulation** — bounded by impact cap + TWAP band + 1h interval (`E-3`), but depends on Icarus `quote()` behavior (verified source on file).
4. **Admin grief of liveness** — `X-4` (target), guardian pause (availability only). Owner is timelocked.
5. **Off-chain indexer/API integrity** — prior review findings; 1 Medium open (§8).

### Permissionless entry points (grep-verified, see `entry-points.md` for the full map)

`launch`, `buy`, `sell`, `graduate`, `abortGraduation` (CurveLaunchpad); `claim`, `buyback` (CurveFeeEscrow); `claim` (HolderReserve); `claim` (LpLocker); `burn` (CurveToken). All value-moving permissionless functions are `nonReentrant`.

### Key attack surfaces

- **Seller insolvency on the launchpad** [[I-4](invariants.md#i-4), [I-2](invariants.md#i-2), [G-14](invariants.md#g-14)] — Can `sell` ever pay out more quote than the launchpad holds? No: `gross ≤ realQuote` per market (`G-8` guard path), `Σ realQuote == totalRealQuote` (`I-2`), `launchpad balance ≥ totalRealQuote` (`I-4`). Highest-signal invariant; verified on-chain **Yes**.
- **Escrow unbacked claims** [[I-9](invariants.md#i-9), [I-10](invariants.md#i-10), [G-19](invariants.md#g-19), [G-21](invariants.md#g-21)] — `totalOwed` can never exceed escrow balance; claims and buybacks only move backed value.
- **`held` vs real balance desync** [[I-3](invariants.md#i-3), [X-1](invariants.md#x-1)] — transfer lock keeps the ledger equal to balances; `buy` has no recipient; sells require the ledger entry.
- **Graduation pool seeding** [[X-2](invariants.md#x-2), [G-11](invariants.md#g-11), [G-12](invariants.md#g-12)] — opening price ≈ curve-end spot; donor-premium deviation bounded and documented.
- **Buyback price manipulation** [[X-3](invariants.md#x-3), [E-3](invariants.md#e-3)] — TWAP-band + impact cap + hourly pacing.
- **Holder reserve claim integrity** [[I-12](invariants.md#i-12), [G-23](invariants.md#g-23), [G-24](invariants.md#g-24)] — exact pro-rata: Σ held == CURVE_SUPPLY at graduation ⇒ claims total to `reserveOf`.
- **Admin operational powers** [[X-4](invariants.md#x-4)] — `setGraduationTarget` has no economic upper bound; extreme values grief new launches. Owner = timelocked multisig (trusted); flagged as the one unvalidated setter-vs-invariant gap.
- **Guardian pause availability** (no invariant link — access-control surface only): freeze of new exposure, instantly; bounded to `launch`/`buy`.
- **Keeper key compromise** (no invariant link): no funds at risk; only permissionless txs and gas spend.

## 3. Invariants

> **Invariant catalog**: [invariants.md](invariants.md) — 28 enforced guards (G-1…G-28), 10 inferred single-contract invariants (I-1…I-10), 4 cross-contract invariants (X-1…X-4), 3 economic invariants (E-1…E-3).
>
> On-chain confirmation: all core conservation invariants (launchpad solvency, escrow solvency, `held`/reserve pairs) verified **Yes** from write-site analysis. The only **On-chain=No** rows are the economic/TWAP-dependent bounds (`X-2…X-4`, `E-3`) and the setter gap (`X-4`).

## 4. Production Readiness

- **Testnet**: deployed and recorded — `deployments/11155931/curveball.json` (launchpad `0xB749…259d2`, all 5 codeHashes, source verification URLs, smoke test record). No committed secrets found (`git grep` for key/mnemonic/0x64-hex patterns hit only examples/verified public addresses and testnet explorer URLs).
- **Mainnet**: **not recorded.** `deployments/4153/` has Icarus verified sources, an `icarus-vs-aerodrome.diff`, and a self-generated `mainnet-readiness.html`, but **no `curveball.json` and no record of the singleton addresses**; `.env.production` has `VITE_LAUNCHPAD_ADDRESS` and `VITE_DEPLOYMENT_BLOCK` empty (consistent with README's "must not be released until record exists").
- **Ops gaps to close before/at audit sign-off**: (a) mainnet deployment record + `.env.production` values; (b) `keeper/.env` production values (dedicated key, RPC); (c) social config — `SOCIAL_ADMIN_ADDRESS` must be set explicitly on mainnet (see open Medium); (d) artwork API rate limit (documented as not yet applied); (e) confirm the timelock/multisig wiring for owner, guardian, treasury on mainnet.

### Backwards-compatibility code
None found in the current source. V1 contracts (`CurveBondingCurve`, `CurveLaunchFactory`, `CurveV1*`, …) exist only in git history; the lean-v2 rewrite intentionally breaks the V1 ABI (ADR 0003). `deployments/11155931/curveball.v1.json` is a retained record, not live code.

## 5. Test Analysis

- **Existence (enumeration, reliable)**: 22 test files, 142 test functions, 2 Foundry invariant files (`test/invariant/Handler.sol` 684 lines, `Invariants.t.sol` 234 lines), fork tests (`test/fork/*`), unit + integration + invariant suites. Structured as launch/trade/graduate/abort/admin/rescue per contract.
- **Execution**: `forge test --summary` runs clean — every visible per-suite result reports `ok, 0 failed` (2026-10-25 scan; aggregate line not captured, all listed suites 0 failed).
- **Coverage**: not regenerated in this scan; stale LCOV/HTML coverage artifacts exist under `contracts/echidna-v2-corpus/` from an earlier run (Sep 2026). Recommend regenerating with `forge coverage` as the audit baseline.
- **Fuzz/invariant**: Foundry native invariant testing configured (`runs=256, depth=64`, `fail_on_revert=false`) — present. **No** active echidna/medusa/halmos/certora configurations were found (`contracts/echidna-v2-corpus/` contains coverage artifacts only, despite the name; `crytic-export/` has historical combined solc json). No symbolic/formal methods.
- **Gaps (by audit impact)**: (1) no independent fuzzer (echidna/medusa) over the curve math and escrow ledgers — high value for `CurveMath` rounding and `totalOwed`/buyback invariants; (2) cover `setGraduationTarget` extremes (owner-grief path, `X-4`); (3) fork tests exist but there is no mainnet-record-based smoke test because mainnet isn't recorded; (4) keeper logic tested (243 lines) but no end-to-end tx-injection test against a live testnet node; (5) no load/perf tests for the social API (documented 3,000-user target untested).

## 6. Docs Quality

Strong for scope: README (architecture, deployment, keeper, social), GLOSSARY (domain), ADR set (0001 chain events, 0002 Drizzle schema, **0003 lean-singleton design + trust assumptions**, 0004 RNS identity), `docs/architecture/social-trading-backend.md` (seams, authoritative-data table, accounting invariants), env examples with explicit "never commit" notes, prior audit reports in-repo.

Gaps: no `@invariant` NatSpec tags anywhere (invariants live in prose comments, e.g. `CurveLaunchpad.sol:78-79`, `:248`); no contract threat-model doc (ADR 0003 covers most of it); no security.txt/code-of-conduct; operator runbooks (key ceremony, timelock setup, monitoring/alerting thresholds) are partial. Recommend converting the prose invariants into `@invariant` tags so Foundry's invariant tooling can label them.

## 7. Git History

- **Branch**: `main` @ `bb0d8b0` (jump commit "feat: ship mainnet and social trading updates"), 231 commits, **single author identity** (`sudotx`, 3 emails). No evidence of external review signals in commit metadata; merge commits exist but from the same author.
- **Hotspots (file churn)**: frontend heavy (`src/style.css` 55, `src/app/useStore.js` 33, `README.md` 32, Market/Trade pages 20-27). Contracts are **low-churn post-refactor**: `CurveLaunchpad.sol` 7 commits, `CurveFeeEscrow.sol` 7, `CurveToken.sol` 1, `CurveLpLocker.sol` 1 — stable since the V2 rewrite.
- **Security-relevant commits**: `15ad664` "fix(contracts): keep sellout reachable when a buyer leaves a dust remainder" (fee-rounding wedge fix — matches `CurveMath` final-fill exemption); `7dd5d24` "test(contracts): pin fork blocks and exercise the real Icarus pause"; `b0a9c8e` "fix: harden launch and social runtime flows"; `1bc980e` "fix: bind only used profile directory SQL parameters"; `ae9b6a6` "refactor(sdk): remove the V1 ABIs and deployment validator" (V2 cutover).
- **Dangerous-area evolution**: `contracts/contracts/` shows the full V1 → V2 replacement (20+ V1 files churned then removed); current HEAD contains only the lean set. No late `contracts/contracts/Curve*.sol` edits after the V2 stabilization beyond the dust fix.
- **Forked deps**: none — `package.json` pins OZ 5.1.0, solady 0.1.26, forge-std v1.17.0 (github tag); bun/node modules normal.
- **Cross-reference**: git stability of the contract layer corroborates §5 (tests kept pace: fork + invariant tests landed with V2). The `15ad664` dust fix is the exact class of bug the invariant set should keep watching (`G-27`, final-fill exemption).

## 8. Prior-Review Status (delta vs current HEAD)

- **Keeper aborts healthy markets on transient RPC error (Medium, 2026-10-18)** — **appears addressed**: current keeper simulates `graduate` first and only chooses `abort` when the simulation confirms a revert; RPC failures back off instead.
- **Moderator role fails open to a hardcoded default address (Medium, 2026-10-18)** — **still present**: `services/social/src/config.mjs:59` defaults `SOCIAL_ADMIN_ADDRESS` to `0x5cc42e…` when unset (mitigated only by env discipline; unset on mainnet = wrong admin). Re-flag for the audit.
- **Donation premium on graduation (Low, documented)** — still by design (`X-2`).
- **Unthrottled unauthenticated route with DB write + outbound fetch (Low–Medium)** — no rate limiter found in this pass; README documents the artwork-API gap explicitly.
- **Indexer reorg-path findings (Medium ×4, 2026-10-18)** — outside this pass's line reading; unchanged code likely; carry in the audit scope.

## X-Ray Verdict

**Tier: CONDITIONALLY READY FOR AUDIT.**

Justification:

- The on-chain core is small (≈900 nSLOC), stable in git (V2 frozen; only a dust-fix landed since), heavily tested (142 foundry tests, invariant suite, fork tests vs real Icarus, prior RR + Dreadnode layering), and — the decisive signal — **every core conservation invariant is enforced on-chain and verified Yes in this scan**: launchpad solvency, escrow solvency, `totalRealQuote`/`held`/`realQuote` pairs, and the transfer-lock check all hold at the write-site level. Admin powers are bounded (no upgrade path, no LP movement, rescue capped at surplus) behind a mandated timelock.
- The conditionality comes from four items, none of which block a contract-layer audit start: (1) **mainnet is not yet recorded** (no `deployments/4153/curveball.json`, empty `.env.production` addresses) — the audit should target **pre-deployment**, which is the ideal time; (2) the **open Medium** from the prior off-chain review (moderator default address) must be fixed before any mainnet social service run; (3) no independent fuzzing (echidna/medusa) over `CurveMath`/escrow ledgers — recommend adding before audit sign-off; (4) `setGraduationTarget`'s unvalidated upper bound (`X-4`) — a small fix (economic cap) that removes the only setter-vs-invariant gap.

Key observations an auditor should verify first: the `totalRealQuote` ↔ per-market `realQuote` ↔ launchpad balance triple; the escrow `totalOwed` ↔ `claimable`+`buybackBalance` split (quote vs token asset branches); the final-fill fee exemption in `quoteBuy`; the Aborted→Recovery state machine; and the Icarus integration points (skim/quote/TWAP windows).

*— Generated by the x-ray pre-audit pipeline (scripts unavailable in installed skill → manual enumeration, bash git analysis; no fabrication; unverified claims marked).*