# Contract Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent unsafe market-state narrowing and stale trade execution before the first public deployment.

**Architecture:** Keep the launchpad immutable and redeploy it after this change. Use OpenZeppelin `SafeCast` at every `uint256` to `uint128` boundary, and make trade expiry explicit in the contract and browser client. The existing division-based first-mint guard stays unchanged: `quoteL > floor(1_000_000 / tokenL)` is equivalent to `tokenL * quoteL > 1_000_000` without risking a product overflow.

**Tech Stack:** Solidity 0.8.24, Foundry, OpenZeppelin 5.1, React, Wagmi/Viem.

**Spec:** This document is the implementation spec; it replaces the incorrect planned multiplication change described in `contracts/scv-scan.md`.

## Global Constraints

- Do not change or deploy the current mainnet gate in `contracts/scripts/Deploy.s.sol`.
- `buyTokens` and `sellTokens` must reject `block.timestamp > deadline` before any token transfer.
- Browser-originated trades use a five-minute deadline generated immediately before submission.
- Do not add dependencies or unlimited token approvals.
- Keep the quote-token deployment constraint explicit: verified RISE WETH only; fee-on-transfer and rebasing assets are unsupported.

---

### Task 1: Bound all packed market state

**Files:**
- Modify: `contracts/contracts/CurveballLaunchpad.sol:3-167`
- Test: `contracts/test/Launchpad.t.sol`

**Interfaces:**
- Produces: constructor reverts if `s` or `vq` exceeds `uint128`.
- Produces: all writes to `Market.vt`, `vq`, `realQ`, and `sold` use `SafeCast.toUint128`.

- [ ] **Step 1: Write failing constructor-bound tests**

```solidity
function testRejectsValuesThatDoNotFitMarketState() external {
    MockWETH quote = new MockWETH();
    MockIcarusFactory factory = new MockIcarusFactory();
    LpLocker locker = new LpLocker(address(this), 5_000);
    vm.expectRevert();
    new CurveballLaunchpad(address(quote), address(factory), address(locker), type(uint128).max + 1, 1, 1);
}
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `pnpm --dir contracts exec forge test --match-test testRejectsValuesThatDoNotFitMarketState`

Expected: FAIL because the current constructor silently accepts the value.

- [ ] **Step 3: Add minimal checked casts**

```solidity
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
using SafeCast for uint256;

require(s > cs && vq > 0 && s <= type(uint128).max && vq <= type(uint128).max, "bad curve");
markets[token] = Market(msg.sender, supply.toUint128(), initialVQ.toUint128(), 0, 0, false, false, address(0));
```

Replace each existing raw `uint128(...)` state write with `.toUint128()`.

- [ ] **Step 4: Run the complete contract suite**

Run: `pnpm --dir contracts test`

Expected: PASS, including the new constructor bound test.

- [ ] **Step 5: Commit**

```sh
git add contracts/contracts/CurveballLaunchpad.sol contracts/test/Launchpad.t.sol
git commit -m "fix: bound launchpad market state"
```

### Task 2: Enforce trade deadlines end-to-end

**Files:**
- Modify: `contracts/contracts/CurveballLaunchpad.sol:79-133`
- Modify: `contracts/test/Launchpad.t.sol`, `contracts/test/GraduationPending.t.sol`, `contracts/test/LpLocker.t.sol`, `contracts/test/fork/IcarusFactory.t.sol`
- Modify: `src/lib/web3.js:29-70`
- Modify: `src/app/useStore.js:106-148`

**Interfaces:**
- Changes: `buyTokens(address token, uint256 quoteIn, uint256 minOut, uint256 deadline)`.
- Changes: `sellTokens(address token, uint256 amount, uint256 minOut, uint256 deadline)`.
- Produces: browser calls with `Math.floor(Date.now() / 1000) + 300`.

- [ ] **Step 1: Write failing expiry tests**

```solidity
function testBuyRejectsExpiredDeadline() external {
    (MockWETH quote, CurveballLaunchpad launchpad) = _deploy(1_000_000, 800_000, 10);
    address token = launchpad.createToken("Expired", "EXP", "");
    quote.mint(TRADER, 1);
    vm.prank(TRADER);
    quote.approve(address(launchpad), 1);
    vm.prank(TRADER);
    vm.expectRevert();
    launchpad.buyTokens(token, 1, 1, 0);
}
```

- [ ] **Step 2: Run the expiry test and verify it fails to compile**

Run: `pnpm --dir contracts exec forge test --match-test testBuyRejectsExpiredDeadline`

Expected: FAIL because the current ABI has no deadline parameter.

- [ ] **Step 3: Add a shared expiry guard and update all call sites**

```solidity
require(block.timestamp <= deadline, "expired");
```

Add `uint256 deadline` as the final parameter to both trade functions. Update all Foundry calls to use `type(uint256).max`, except the explicit expiry test. Update both frontend ABI items and append this value to the browser transaction arguments.

- [ ] **Step 4: Run contract and browser checks**

Run: `pnpm --dir contracts test && bun run typecheck && bun test && bun run build`

Expected: PASS; the fork lifecycle remains green and the browser submits the new ABI shape.

- [ ] **Step 5: Commit**

```sh
git add contracts src/lib/web3.js src/app/useStore.js
git commit -m "fix: expire stale launchpad trades"
```

### Task 3: Correct the security record and deployment constraints

**Files:**
- Modify: `contracts/scv-scan.md:141-195`
- Modify: `README.md:138-146`

**Interfaces:**
- Produces: security notes that accurately state the division guard is safe and that public deployment uses verified standard WETH.

- [ ] **Step 1: Replace the incorrect L-02 recommendation**

State that the division condition is the overflow-safe equivalent of the first-mint product threshold; retain the test that proves a too-small pool defers graduation.

- [ ] **Step 2: State the quote-token constraint in deployment documentation**

Document RISE WETH `0x4200000000000000000000000000000000000006`, the verified Icarus PoolFactory, and that deployment inputs must be independently re-verified immediately before broadcast.

- [ ] **Step 3: Verify documentation references**

Run: `rg -n "L-02|fee-on-transfer|deadline|WETH" contracts/scv-scan.md README.md`

Expected: the old multiplication recommendation is absent and deployment constraints are explicit.

- [ ] **Step 4: Commit**

```sh
git add contracts/scv-scan.md README.md
git commit -m "docs: clarify launchpad deployment constraints"
```

## Self-Review

- SafeCast covers every packed-state conversion; no raw `uint128(...)` remains in production launchpad code.
- Every trading call passes a deadline; expiration is checked before value movement.
- The division liquidity guard is retained because it is exact and overflow-safe.
- The plan adds no proxy, no new dependency, and no mainnet deployment path.
