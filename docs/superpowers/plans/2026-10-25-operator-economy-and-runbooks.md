# Operator Economy + Runbooks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Curveball's operational costs measurable, its keeper self-alerting on balance, its monitoring/runbooks concrete, and its mainnet authority ceremony repeatable — so "operator ready" is a checklist, not folklore.

**Architecture:** Add a cost-measurement script fed from the recorded testnet deployment receipts; extend the keeper with a rate-limited balance alert; write two ops docs (monitoring, ceremony); add a `deploy/doctor.sh` that catches config/drift/environment failures in seconds.

**Tech Stack:** Node/Bun + viem, bash, systemd, Sentry, Postgres/Docker (as documented by existing deploy stack).

**Spec:** Prior deliverable `x-ray/x-ray.md` §4 + §8, `keeper/README.md`, `deploy/README.md`, `docs/architecture/social-trading-backend.md` (capacity/wallet limits).

## Global Constraints

- Keeper txs are permissionless only (graduate/abort/buyback) — the keeper key can never move user funds; its budget is gas-only.
- `BUYBACK_INTERVAL = 1h`, `BUYBACK_CHUNK_BPS = 2500` (chunk capped to `BUYBACK_MAX_IMPACT_BPS = 25` of pool reserve), `GRADUATION_TIMEOUT = 7 days`.
- Do not add HTTP endpoints to the keeper (README: "needs no HTTP server, no health endpoint"); alerts go through Sentry + logs.
- New env vars must be documented in the matching `.env.example` and validated at startup with the same `required()`/range-check pattern used today.
- All docs under `docs/operations/`; all scripts under `deploy/`.

## Review Focus

- **Keeper wallet empties unnoticed** — the balance alert must not spam (1 alert/hour while below threshold) but must fire when crossing below, in Sentry and logs.
- **Cost model numbers fabricated** — every figure must trace to a measured testnet receipt or an explicitly labeled assumption range; the doc must show its arithmetic.
- **Ceremony can't be faked** — the ceremony doc must require each signer to independently verify the record's `codeHashes` against `forge inspect` output *before* any signature.
- **Doctor misleads with stale env** — `doctor.sh` must exit non-zero on any failed check and print which check failed; `--offline` must not mark network-dependent checks as passed.
- **Monitoring doc drifts from reality** — every referenced command (systemd units, backup restore) must be copy-pasteable from the actual repo paths/compose files.

---

### Task 1: Keeper cost model (measured, not guessed)

**Files:**
- Create: `deploy/estimate-costs.mjs`
- Create: `deploy/estimate-costs.test.mjs`
- Create: `docs/operations/cost-model.md`
- Test: `bun test deploy/estimate-costs.test.mjs`

**Interfaces:**
- Produces: `export function gasToWei(gasUsed: number, gwei: number): number`; `export function estimateMonthly({ graduationsPerDay, abortsPerDay, buybacksPerDay, gasPerGraduation, gasPerAbort, gasPerBuyback, gwei, keeperGasRefillReserveDays }): { monthlyGasUnits: number; monthlyGasWei: number; annualGasWei: number; refillAmountWei: number }`.
- Reads: record `deployments/<chainId>/curveball.json` transactions + optional RPC/explorer fetch of gasUsed for each tx (HTTPS-only; `--offline` uses provided `--gas-per-*` defaults).

- [ ] **Step 1: Write the failing test** — arithmetic cases: `gasToWei(100000, 0.01) === 100000n`-era wei (assert exact BigInt math with documented gwei); `estimateMonthly` with `graduationsPerDay=10, abortsPerDay=3, buybacksPerDay=5` produces the hand-computed monthly units, and `refillAmountWei = monthlyGasWei * refillReserveDays / 30` (round up).

- [ ] **Step 2: Run the test to verify it fails** — `bun test deploy/estimate-costs.test.mjs` → FAIL

- [ ] **Step 3: Implement `estimate-costs.mjs`** — CLI `bun deploy/estimate-costs.mjs --record deployments/11155931/curveball.json --gwei <price> --graduations 10 --aborts 3 --buybacks 5`; in `--live` mode fetch receipts from `https://explorer.testnet.riselabs.xyz/api/v2/transactions/<hash>` (Blockscout API) for the smoke txs; else use defaults `gasPerGraduation=650000, gasPerAbort=120000, gasPerBuyback=350000` labeled clearly as assumptions pending measurement.

- [ ] **Step 4: Run the test to verify it passes** — `bun test deploy/estimate-costs.test.mjs` → PASS. Then run once in `--live` against the recorded testnet smoke tx hashes (from `deployments/11155931/smoke.json` when available, else skip network and note in the doc).

- [ ] **Step 5: Write `docs/operations/cost-model.md`** — the measured table (gas/action), the scenario table (5/10/25 markets/day), monthly/annual ETH at current RISE L2 prices, the funding policy (3-month reserve, refill when balance < 1 month), a one-line formula, and every number's provenance.

- [ ] **Step 6: Commit**

```bash
git add deploy/estimate-costs.mjs deploy/estimate-costs.test.mjs docs/operations/cost-model.md
git commit -m "feat(ops): keeper cost model from measured testnet receipts"
```

### Task 2: Keeper balance alert

**Files:**
- Modify: `keeper/graduation-keeper.mjs`
- Modify: `keeper/instrument.mjs`
- Modify: `keeper/graduation-keeper.test.mjs`
- Modify: `keeper/.env.example`
- Test: `npm test` in `keeper/`

**Interfaces:**
- Produces: `export function decideBalanceAlert({ balanceWei, thresholdWei, lastAlertAtMs, nowMs }): "alert" | "ok" | "skip"` — `"alert"` when `balanceWei < thresholdWei` and (`lastAlertAtMs == null` or `nowMs - lastAlertAtMs >= 3_600_000`); `"ok"` when above threshold; `"skip"` when below but within the 1h window.
- Config: `KEEPER_BALANCE_ALERT_THRESHOLD_ETH` (default `0.01`, must parse as finite ≥ 0), `KEEPER_BALANCE_CHECK_INTERVAL_MS` (default `600_000`, ≥ 60_000). Both validated in `main()`'s existing config block.

- [ ] **Step 1: Write the failing test** — cases: below threshold → `"alert"`; above → `"ok"`; below again within 1h → `"skip"`; below after 1h → `"alert"`; `threshold=0` disables alerting (`"ok"` always); bad env (`"abc"`) rejected by the config validator.

- [ ] **Step 2: Run the test to verify it fails** — `npm test` in `keeper/` → FAIL

- [ ] **Step 3: Implement** — `decideBalanceAlert` as a pure function; in `tick()`, every `KEEPER_BALANCE_CHECK_INTERVAL_MS` read `publicClient.getBalance({ address: walletClient.account.address })`, feed `decideBalanceAlert`, and on `"alert"` call `captureKeeperException(new Error(...), "keeper-balance")` with a `messageLevel: "warning"`-style tag plus `console.warn`. Store `lastAlertAtMs` in a module-level variable (no persistence needed — restart resets the timer; acceptable and documented).

- [ ] **Step 4: Run the test to verify it passes** — `npm test` in `keeper/` → PASS. `node --check keeper/graduation-keeper.mjs` clean.

- [ ] **Step 5: Commit**

```bash
git add keeper/graduation-keeper.mjs keeper/instrument.mjs keeper/graduation-keeper.test.mjs keeper/.env.example
git commit -m "feat(keeper): rate-limited balance alert via Sentry"
```

### Task 3: Monitoring, backups, and process supervision doc

**Files:**
- Create: `docs/operations/monitoring.md`
- Modify: `deploy/README.md` (link to monitoring doc)
- Test: doc-internal commands validated by running them against the local stack (`docker compose --env-file deploy/production.env -f compose.production.yaml config` and `bun run --cwd packages/db build`)

**Interfaces:**
- Produces: runnable, copy-pasteable sections: (1) systemd unit snippets for `social-api`, `social-indexer`, `social-worker`, `keeper` (WorkingDirectory + `ExecStart` from `services/social/package.json` and `keeper/package.json` scripts; `Restart=always; RestartSec=5`); (2) health checks: `curl -sf https://social-api.curveball.fun/health` and keeper process + log checks; (3) Postgres backup: `pg_dump` (schema + data) with the existing `postgres_data` volume caveat, retention, and a **quarterly restore drill checklist**; (4) Sentry alert routing table (error levels, `curveball-backend@<release>`, `curveball-keeper@<release>`), sampling rates; (5) Nginx proxy rate-limit snippet for `/api/artwork` (2 MB body limit + burst limit) per `deploy/README.md`.

- [ ] **Step 1: Write the doc** with every command inline, referencing the real unit names/scripts from `package.json` files.
- [ ] **Step 2: Execute the doc's local commands** — `docker compose --env-file deploy/production.env -f compose.production.yaml config` succeeds; `bun run --cwd ../../packages/db build` (from `services/social`) succeeds; fix any command that fails before committing.
- [ ] **Step 3: Commit**

```bash
git add docs/operations/monitoring.md deploy/README.md
git commit -m "docs(ops): monitoring, backup and supervision runbooks"
```

### Task 4: Mainnet authority ceremony doc (multisig + timelock)

**Files:**
- Create: `docs/operations/mainnet-ceremony.md`
- Modify: `docs/operations/mainnet-runbook.md` (from the deployment-record plan) to link here for the authorities step

**Interfaces:**
- Produces: the ceremony checklist covering: Safe multisig creation for owner-proposer (recommend 2-of-3), guardian multisig (recommend 3-of-5 with one hardware-wallet signer), treasury Safe; TimelockController deployment with `minDelay = 2 days` via OZ (recommended default, matches `CURVE_MIN_TIMELOCK_DELAY`), `PROPOSER_ROLE` → proposer Safe, `EXECUTOR_ROLE` → `address(0)` (anyone can execute after delay); signer pre-verification steps (each signer runs `forge inspect <contract> deployedBytecode | cast keccak` and compares to `deployments/<chain>/curveball.json.codeHashes`); the "explicit production policy" approval step (who signs off, how it's recorded); and out-of-band key custody notes (never in env, never in CI).

- [ ] **Step 1: Write the doc** — include exact OZ deploy commands (`cast send`/`forge create` snippets are prohibited as broadcast-by-default; use script-based deploy with the existing `CurveDeploy.sol` pattern and a new `TimelockDeploy.s.sol` if needed — note the choice explicitly).
- [ ] **Step 2: Add `contracts/scripts/DeployTimelock.s.sol`** if needed: script that reads `CURVE_TIMELOCK_DELAY` (env, default 172800), `CURVE_TIMELOCK_PROPOSER`, deploys `TimelockController(minDelay, [proposer], [executor=0x0])`, prints addresses; wire a `make deploy-timelock-testnet` (testnet only) target guarded like `deploy-testnet`.
- [ ] **Step 3: Run** `forge build` and `forge test` to keep the suite green; `bun test` untouched.
- [ ] **Step 4: Commit**

```bash
git add docs/operations/mainnet-ceremony.md contracts/scripts/DeployTimelock.s.sol contracts/Makefile
git commit -m "docs(ops): mainnet authority ceremony and timelock deploy script"
```

### Task 5: `deploy/doctor.sh` — environment and record health

**Files:**
- Create: `deploy/doctor.sh`
- Create: `deploy/doctor.test.sh` (bash + bun; runs fixtures)
- Modify: `deploy/README.md` (usage line)
- Test: `bash deploy/doctor.test.sh` (or via `bun test`, choose one and keep it consistent)

**Interfaces:**
- Produces: `deploy/doctor.sh [--network mainnet|testnet] [--offline]` printing one line per check (`[ok] | [FAIL] name — detail`) and exiting `1` if any check fails. Checks: required binaries (`cast`, `bun`, `docker`), RPC reachable + chain id matches record (skip in `--offline`), record exists + `bun contracts/scripts/record-schema.ts` parse (via a tiny `--check` entry on `record-schema.ts` exporting `checkJsonFile(path)`), `.env.production`/`deploy/*.env` parity with record launchpad/block, git clean vs recorded `sourceCommit` (warn only), `SENTRY_*` placeholders absent, and `SOCIAL_ADMIN_ADDRESS` set when network is mainnet (explicitly nowhere near `0x5cc42e…`).

- [ ] **Step 1: Write the failing test** — fixture dir with a valid v2 record + envs: (a) all-pass run exits 0 and prints `[ok]` for each check; (b) tampered record (bad address) exits 1 naming the record check; (c) `--offline` exits 0 while network checks are labeled `[skip]` (never `[ok]`); (d) missing `SOCIAL_ADMIN_ADDRESS` on mainnet exits 1.
- [ ] **Step 2: Run the test to verify it fails** — `bash deploy/doctor.test.sh` → FAIL
- [ ] **Step 3: Implement `doctor.sh`** — plain bash + jq-free parsing (use `bun` for JSON when available); no dependencies beyond what the repo already requires; keep each check as a function so the test can source the script and invoke them (`source deploy/doctor.sh --lib` guard).
- [ ] **Step 4: Run the test to verify it passes** — `bash deploy/doctor.test.sh` → PASS. Run against the real repo offline: `deploy/doctor.sh --offline` (mainnet record absent → must FAIL with "record missing", which is correct pre-deployment).
- [ ] **Step 5: Commit**

```bash
git add deploy/doctor.sh deploy/doctor.test.sh deploy/README.md
git commit -m "feat(ops): deploy doctor for env/record/RPC health"
```

---

## Self-Review

- **Spec coverage:** cost model (Task 1), keeper alerting (Task 2), monitoring/backup (Task 3), ceremony (Task 4), drift/health (Task 5) — all four x-ray "operator" gaps covered.
- **Step scan:** every step has a checkable outcome; no step asks for "appropriate" anything without a concrete command.
- **Type consistency:** `decideBalanceAlert` signature fixed in Task 2 and used by the test and implementation; `estimateMonthly` fixed in Task 1.
- **Review Focus:** spam-free alert (Task 2 test), measured-not-guessed numbers (Task 1 live run + provenance column), signer-independent verification (Task 4), non-misleading doctor output (Task 5c), commands run before commit (Task 3).
- **Proportion:** 5 tasks, mostly independent; docs-heavy where automation would be overkill (ceremony, monitoring).