# Deployment Record v2 + Mainnet Config Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the deployment record to a machine-validated `record-v2` schema with authorities/build metadata, make the config pipeline testnet-independent, add live-record drift verification, and ship a mainnet runbook.

**Architecture:** Extend the existing Foundry/Bun deploy pipeline (`scripts/Deploy.s.sol` → `scripts/record-production.ts` → `scripts/sync-production-config.ts` → `deploy/prepare-production-env.mjs`). A single `record-schema.ts` validator becomes the one source of truth for record shape; `DeployChecks.sol` makes the preflight unit-testable; a new `verify-record` step proves the live chain still matches the record.

**Tech Stack:** Solidity 0.8.24 (Foundry), TypeScript on Bun, viem, Makefile.

**Spec:** Prior deliverable `x-ray/x-ray.md` §4 (production readiness gaps), `contracts/Makefile`, `contracts/scripts/record-production.ts`, `deploy/prepare-production-env.mjs`, `deploy/README.md`.

## Global Constraints

- Chain IDs: mainnet `4153`, testnet `11155931`; quote `0x4200…0006`; mainnet Icarus `0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615`.
- Fee policy constants (must never change): `launchFee = 1000000000000000`, `feeBps = 75`, `creatorShareBps = 5000`, `buybackShareBps = 2500`, `taxCapBps = 50`, `supply = 1e24`, `curveSupply = 8e23`, `maxReserveBps = 400`, `graduationTarget ≥ 1e16`.
- Record files are immutable artifacts: `record-production.ts` must refuse to overwrite an existing file (current behavior).
- Env discipline: never write secrets into tracked files; generated env files keep mode `0600`.
- Keep the existing `lean-v2` record readable for downgrade consumers until all consumers ship in this plan; switch consumers in the same commit that changes the schema.

## Review Focus

- **Operator regenerates production env from a stale record** — `prepare-production-env` must refuse when record `chainId` ≠ requested network, and must never write a `testnet-` release for a mainnet record.
- **Bytecode hash drift between local build and live chain** — `record-production` must compare each singleton's live keccak against the built artifact bytecode and abort on mismatch for mainnet.
- **Timelock with zero delay slips through** — preflight must enforce `getMinDelay() ≥ CURVE_MIN_TIMELOCK_DELAY` (default 2 days), not just `!= 0`.
- **Frontend RPC default leaks to public** — the frontend Vite build needs *some* public RPC; the record/config tooling must not bless `https://rpc.risechain.com` as an operational RPC for private flows.
- **Record consumers silently break on schema change** — every consumer (`sync-production-config.ts`, `prepare-production-env.mjs`, `Smoke.s.sol`, keeper `readConstants`) must be updated in the same commit as the schema bump.

---

### Task 1: Record schema v2 + validator

**Files:**
- Create: `contracts/scripts/record-schema.ts`
- Create: `contracts/scripts/record-schema.test.ts`
- Test: `bun test contracts/scripts/record-schema.test.ts`

**Interfaces:**
- Produces: `export type DeploymentRecord` (exact shape below), `export function parseAndValidateRecord(input: unknown): DeploymentRecord`, `export class RecordValidationError extends Error { fields: string[] }`.

- [ ] **Step 1: Write the failing test**

```ts
// record-schema.test.ts
import { parseAndValidateRecord, RecordValidationError } from "./record-schema";
const VALID = { /* exact fixture object per the type below, mainnet variant */ };
test("accepts a valid mainnet record", () => expect(parseAndValidateRecord(VALID).chainId).toBe(4153));
test.each([
  ["missing authorities.timelock on mainnet", {...VALID, authorities: {...VALID.authorities, timelock: null}}],
  ["timelock delay 0", {...VALID, authorities: {...VALID.authorities, timelock: {delaySeconds: 0, proposer: VALID.authorities.owner}}}],
  ["feeBps 201", {...VALID, policy: {...VALID.policy, feeDefaults: {...VALID.policy.feeDefaults, feeBps: 201}}}],
  ["bad chainId", {...VALID, chainId: 1}],
  ["codeHash not 66-hex", {...VALID, codeHashes: {...VALID.codeHashes, CurveLaunchpad: "0x1234"}}],
  ["transactions name/order mismatch", {...VALID, transactions: [...VALID.transactions].reverse()}],
])("rejects %s", (_name, bad) => expect(() => parseAndValidateRecord(bad)).toThrow(RecordValidationError));
```

- [ ] **Step 2: Run the test to verify it fails** — `bun test contracts/scripts/record-schema.test.ts` → FAIL (module missing)

- [ ] **Step 3: Implement `record-schema.ts`**

Exact type:

```ts
export type DeploymentRecord = {
  version: "record-v2";
  release: "mainnet" | "testnet";
  chainId: 4153 | 11155931;
  deployedAt: string;                    // ISO 8601
  sourceCommit: string;                  // 40-hex
  sourceDirty: boolean;
  build: { forge: string; bytecodeHashesMatchBuild: boolean };
  launchpad: string; deploymentBlock: string;
  quote: string; icarusFactory: string;
  authorities: {
    owner: string;
    timelock: { delaySeconds: number; proposer: string } | null; // non-null iff mainnet
    guardian: string; guardianKind: "multisig" | "eoa";
    treasury: string; treasuryKind: "safe" | "eoa";
  };
  policy: {
    launchFee: string; graduationTarget: string;
    feeDefaults: { feeBps: number; creatorShareBps: number; buybackShareBps: number; taxCapBps: number };
    supply: string; curveSupply: string; maxReserveBps: string;
  };
  singletons: { escrow: string; locker: string; reserve: string; tokenImplementation: string };
  codeHashes: Record<string, string>;
  sourceVerification: Record<string, { name: string; url: string }>;
  transactions: Array<{ name: string; address: string; hash: string; blockNumber: string }>;
  urls: { explorer: string; readiness?: string };
};
```

Checks in `parseAndValidateRecord`: shape presence, `getAddress`-checksummandity of every address, chainId enum, policy constants from Global Constraints (exact equality for launchFee/supply/curveSupply/maxReserveBps/feeDefaults; `graduationTarget ≥ 10_000_000_000_000_000n`), `timelock != null` iff mainnet, `timelock.delaySeconds ≥ 172800` on mainnet, `codeHashes` keys exactly `["CurveFeeEscrow","CurveLpLocker","CurveHolderReserve","CurveLaunchpad","CurveToken"]` with 66-hex values, `transactions.length === 4` and names/order equal that list minus CurveToken, `sourceCommit` regex `/^[0-9a-f]{40}$/` and `deployedAt` parseable by `Date.parse`.

- [ ] **Step 4: Run the test to verify it passes** — `bun test contracts/scripts/record-schema.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add contracts/scripts/record-schema.ts contracts/scripts/record-schema.test.ts
git commit -m "feat(scripts): record-v2 schema and validator"
```

### Task 2: Unit-testable deploy preflight + timelock delay floor

**Files:**
- Create: `contracts/scripts/DeployChecks.sol` (library, importable by tests)
- Modify: `contracts/scripts/Deploy.s.sol` — `preflight()` delegates to `DeployChecks`, reads no env inside checks
- Create: `contracts/test/unit/DeployPreflight.t.sol`
- Modify: `contracts/Makefile` — no change yet (tests run via `forge test`)

**Interfaces:**
- Produces: `library DeployChecks { function checkAuthority(CheckParams memory p) external view; }` where `CheckParams` carries `(bool isMainnet, address owner, address proposer, address guardian, address treasury, uint256 timelockDelay, uint256 minDelay, address icarusFactory)`; reverts with `Preflight(string)` — reuses existing `Preflight` error style (define `error Preflight(string)` inside the library and let `Deploy` and tests catch it).
- Consumes: `Deploy.s.sol` keeps `params()` reading env (`CURVE_OWNER`, `CURVE_GUARDIAN`, `CURVE_TREASURY`, `CURVE_TIMELOCK_PROPOSER`, `CURVE_GRADUATION_TARGET`, new `CURVE_MIN_TIMELOCK_DELAY` default 172800).

- [ ] **Step 1: Write the failing test** — `contracts/test/unit/DeployPreflight.t.sol` with a `FakeTimelock` exposing `getMinDelay()`/`hasRole()`. Cases, each expecting `require`-style revert with matching string: delay `0` → "owner timelock has no delay"; delay `< minDelay` → "owner timelock delay below minimum"; proposer without PROPOSER_ROLE → "proposer lacks PROPOSER_ROLE"; EOA guardian → "guardian is not a contract"; EOA treasury → "treasury is not a contract"; mainnet + missing proposer param (address(0)) → "timelock proposer missing"; target below MIN_TARGET → "graduation target below MIN_TARGET". Compile with `forge test --mc DeployPreflightTest`.

- [ ] **Step 2: Run the test to verify it fails** — `forge test --match-contract DeployPreflightTest` → FAIL

- [ ] **Step 3: Implement `DeployChecks.sol` and refactor `Deploy.s.sol`** — move every `_require` out of `Deploy.preflight`; `preflight` becomes `checkAuthority(params)` after computing `timelockDelay` via `getMinDelay()` (try/catch → revert "owner has no getMinDelay"); delete `_require` from `Deploy`; add `uint256 minDelay = vm.envOr("CURVE_MIN_TIMELOCK_DELAY", uint256(172800))` in `params()`/preflight glue, keeping `vm.env*` reads only at the call site.

- [ ] **Step 4: Run the tests to verify they pass** — `forge test --match-contract DeployPreflightTest` → PASS (all 6 cases); `forge test` full suite still green; `forge build --sizes` unchanged

- [ ] **Step 5: Commit**

```bash
git add contracts/scripts/DeployChecks.sol contracts/scripts/Deploy.s.sol contracts/test/unit/DeployPreflight.t.sol
git commit -m "feat(deploy): unit-testable authority preflight with min timelock delay"
```

### Task 3: record-production emits record-v2 with live verification

**Files:**
- Modify: `contracts/scripts/record-production.ts`
- Modify: `contracts/scripts/sync-production-config.ts` (validate via schema)
- Test: extend `contracts/scripts/record-schema.test.ts` with a live-record fixture test (structurally only; network calls stay in the script)

**Interfaces:**
- Consumes: `parseAndValidateRecord` from Task 1; `DeploymentRecord` type.
- Produces: rewritten `record-production.ts` that (1) calls `DeployChecks`-style logic implicitly by reading live `owner`/`guardian`/`treasury` and `getMinDelay()` (mainnet: abort if call fails, require `delaySeconds ≥ CURVE_MIN_TIMELOCK_DELAY` and `proposer` from env `CURVE_TIMELOCK_PROPOSER`), (2) computes `bytecodeHashesMatchBuild` by reading each singleton's `out/<Contract>.sol/<Contract>.json` → `deployedBytecode.object` → `keccak256("0x" + object)`, aborting on mismatch for mainnet, (3) writes `sourceDirty`, `build.forge` (from `forge --version`), `deployedAt`, `urls`, (4) validates the assembled record through `parseAndValidateRecord` before writing.

- [ ] **Step 1: Write the failing test** — in `record-schema.test.ts`: `test("assembled record round-trips through the validator", () => { const record = buildRecordFixture(); expect(parseAndValidateRecord(record)).toBeTruthy(); })` where `buildRecordFixture` is exported from a new `contracts/scripts/record-fixture.ts`. Add mismatch cases: `bytecodeHashesMatchBuild:false` accepted structurally; `authorities.timelock` null on mainnet rejected (already in Task 1).

- [ ] **Step 2: Run the test to verify it fails** — `bun test contracts/scripts/record-schema.test.ts` → FAIL (`record-fixture` missing)

- [ ] **Step 3: Implement the rewrite** — keep the broadcast parsing and `validateLaunchpad` wiring exactly as-is; add the new fields; keep the "Refusing to overwrite" guard; require `CONFIRM_RECORD_PRODUCTION` for mainnet (existing).

- [ ] **Step 4: Run the tests to verify they pass** — `bun test contracts/scripts/record-schema.test.ts` → PASS. Manual pre-flight only (no broadcast): `DEPLOYMENT_NETWORK=testnet bun contracts/scripts/record-production.ts` must not be run (no pending broadcast); instead run `bun contracts/scripts/record-fixture.ts` sanity. Document that a real testnet record cannot be regenerated (immutability) — covered by the smoke test in Task 5.

- [ ] **Step 5: Commit**

```bash
git add contracts/scripts/record-production.ts contracts/scripts/record-fixture.ts contracts/scripts/record-schema.ts contracts/scripts/record-schema.test.ts contracts/scripts/sync-production-config.ts
git commit -m "feat(scripts): emit and validate record-v2 with build bytecode verification"
```

### Task 4: Mainnet-capable production env generator

**Files:**
- Modify: `deploy/prepare-production-env.mjs`
- Create: `deploy/prepare-production-env.test.mjs`
- Test: `bun test deploy/prepare-production-env.test.mjs`

**Interfaces:**
- Produces: `export function createProductionEnv({ network, rootDir, recordPath, envFiles, outDir })` — pure, no imports of real paths; `main()` reads `process.argv` for `--network` (default `testnet`), resolves `deployments/<chainId>/curveball.json` from the record itself (never the hard-coded `11155931` path).
- Consumes: `parseAndValidateRecord` (Task 1) — reject any record that fails schema.

- [ ] **Step 1: Write the failing test** — temp-dir fixtures with a valid v2 testnet record and envs (`.env`, `services/social/.env`, `keeper/.env`): (a) generation writes 4 files, each mode `0600`, release prefix `testnet-`; (b) passing a fixture mainnet record with `--network testnet` throws "record chainId does not match"; (c) parity check still throws when a source env's launchpad differs from the record; (d) `adminAddress` resolution prefers `SOCIAL_ADMIN_ADDRESS` and never falls back to `0x5cc42e…` (no default in v2 — throws if absent on mainnet).

- [ ] **Step 2: Run the test to verify it fails** — `bun test deploy/prepare-production-env.test.mjs` → FAIL

- [ ] **Step 3: Implement the refactor** — extract the current top-level logic into `createProductionEnv`; remove the hard-coded record path; `main()` wires CLI flags; keep `randomBytes` password generation and `chmodSync(0o600)`.

- [ ] **Step 4: Run the test to verify it passes** — `bun test deploy/prepare-production-env.test.mjs` → PASS

- [ ] **Step 5: Commit**

```bash
git add deploy/prepare-production-env.mjs deploy/prepare-production-env.test.mjs
git commit -m "feat(deploy): network-aware production env generator with record validation"
```

### Task 5: Live-record drift verification + config parity check

**Files:**
- Create: `contracts/scripts/verify-record.ts`
- Modify: `contracts/Makefile` (targets `verify-record`, `verify-record-testnet`, `ensure-record-absent`)
- Test: `contracts/scripts/record-schema.test.ts` gains a `verifyLiveRecord(record, client)` structural test (mock client), and a README note that real drift checks run against testnet RPC via `make verify-record-testnet` (CI_FORK-gated, skips without RPC).

**Interfaces:**
- Produces: `export async function verifyLiveRecord(record, client, network): Promise<Array<{check: string; ok: boolean; detail?: string}>>` — re-reads `owner/guardian/treasury/launchFee/graduationTarget/feeDefaults/paused`, `singletons` via `validateLaunchpad`, live `keccak256(getBytecode)` vs record `codeHashes`, explorer `is_verified/name` vs record `sourceVerification`; returns per-check results, throws on RPC/network error only.

- [ ] **Step 1: Write the failing test** — mock client returning canned view values; assert a drift in `owner` produces `ok:false` with `check:"authorities.owner"` and that a matching record yields all `ok:true`.

- [ ] **Step 2: Run the test to verify it fails** — `bun test contracts/scripts/record-schema.test.ts` → FAIL

- [ ] **Step 3: Implement `verify-record.ts`** — CLI: `bun contracts/scripts/verify-record.ts --network testnet` → loads record, connects (HTTPS only, `cast chain-id`-style check), prints a table, exit 1 on any `ok:false`. Makefile: `verify-record-testnet` requires `RISE_TESTNET_RPC_URL`; `ensure-record-absent` fails if `deployments/4153/curveball.json` exists (used by `deploy-production`).

- [ ] **Step 4: Run the test to verify it passes** — unit: PASS. Live optional: `make verify-record-testnet` with RPC set (CI or local); record currently on disk is `lean-v2` so this target also gets a migration note: verify-record accepts `lean-v2` for one release cycle only for testnet, then requires upgrade.

- [ ] **Step 5: Commit**

```bash
git add contracts/scripts/verify-record.ts contracts/Makefile contracts/scripts/record-schema.test.ts
git commit -m "feat(deploy): verify live chain against the deployment record"
```

### Task 6: Mainnet runbook + schema/consumer migration, docs

**Files:**
- Create: `docs/operations/mainnet-runbook.md`
- Modify: `deploy/README.md`, `deploy/production.env.example` (mainnet-oriented comments), `keepers`/`services/social` README references to `KEEPER_LAUNCHPAD_ADDRESS` etc. (no code change — parity is enforced by Task 4)
- Consumers to migrate in this task (must land together): `contracts/scripts/Smoke.s.sol` (reads `launchpad`, `singletons` — no schema break), `contracts/scripts/sync-production-config.ts` (validates through `parseAndValidateRecord`), `keeper` reads (unchanged — top-level fields preserved).

- [ ] **Step 1: Update `deploy/production.env.example`** — replace `VITE_CHAIN_ID=11155931` copy with both-network comments; add `CURVE_MIN_TIMELOCK_DELAY` and `SOCIAL_ADMIN_ADDRESS` explicit-not-optional notes.

- [ ] **Step 2: Write `docs/operations/mainnet-runbook.md`** — numbered: set RISE_MAINNET_RPC_URL (private), authorities (point at ceremony doc — see operator-economy plan), `make production-preflight`, `CONFIRM_DEPLOY=… make deploy-production`, `CONFIRM_RECORD_PRODUCTION=… make record-production` (validates + writes record-v2), `make verify-record-mainnet`, `bun deploy/prepare-production-env.mjs --network mainnet`, Vercel + keeper + social env sync, post-deploy smoke triggers, "production policy approval" gate (matches `deployments/4153/mainnet-readiness.html` status line).

- [ ] **Step 3: Wire `deploy-production` to depend on `ensure-record-absent`** in the Makefile and document the redeploy policy (a redeploy requires explicit `ALLOW_REDEPLOY=1` after `verify-record-mainnet`).

- [ ] **Step 4: Run the full suite** — `make -C contracts test && bun test` (repo-wide) green; `bun test deploy/prepare-production-env.test.mjs` green.

- [ ] **Step 5: Commit**

```bash
git add docs/operations/mainnet-runbook.md deploy/README.md deploy/production.env.example contracts/Makefile contracts/scripts/Smoke.s.sol contracts/scripts/sync-production-config.ts
git commit -m "docs(deploy): mainnet runbook and record-v2 consumer migration"
```

---

## Self-Review

- **Spec coverage:** x-ray gaps §4 (record, config, RPC, rate limit, admin) map to Tasks 1-6; global constraints enforced by Task 1 validator.
- **Step scan:** every step names a file/signature and a concrete value (constants verbatim from Global Constraints).
- **Type consistency:** `DeploymentRecord` shape defined once in Task 1 and consumed verbatim by Tasks 3-6.
- **Review Focus:** stale-record refusal (Task 4b), bytecode-match abort (Task 3), delay floor (Task 2), public-RPC note (Task 6, runbook + Task 4 keeps `VITE_RPC_URL` sourced from env), consumer migration (Task 6 lands with schema, Task 5 testnet legacy note).
- **Proportion:** 6 tasks, each with an independently testable deliverable; no function bodies beyond the type definition and the access-path decisions the implementer cannot infer.