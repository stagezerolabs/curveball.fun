---
name: curveball-threat-model
description: Use when reviewing, auditing, or threat-modeling the Curveball launchpad, its CurveLaunchpad/CurveFeeEscrow/CurveLpLocker/CurveHolderReserve/CurveToken contracts, the social service, the graduation keeper, or the RISE deployment. Establishes the trust model, the asset inventory, and the specific invariants a reviewer must check before reporting generic findings.
---

# Curveball threat model

Curveball is a token launchpad on RISE (chain 4153). One `CurveLaunchpad` singleton runs
every market; each launch is an EIP-1167 `CurveToken` clone. Read this before forming
findings — plenty of things that look like bugs are deliberate, and the ADR says so.
Reporting an intentional design choice as a vulnerability wastes the reader's trust.

**Read `docs/adr/0003-lean-singleton-launchpad.md` first.** It is the authoritative list
of accepted risks. Every "Decisions and the trust assumptions they leave" bullet is a
documented tradeoff, not a finding. If you believe one is wrong, you must argue *why the
tradeoff fails in a way the ADR didn't anticipate* — not restate it.

## Asset inventory

| Asset | Where | Why it matters |
|---|---|---|
| Curve WETH | `CurveLaunchpad` holds `totalRealQuote` | Quote owed to curve sellers. Must always be backed. |
| Launch inventory | `CurveLaunchpad` token balances | Unsold curve tokens. Pre-graduation these are *not* rescuable. |
| Escrow liabilities | `CurveFeeEscrow.claimable` + `buybackBalance` | Creator/treasury claims and buyback budgets. `totalOwed` is the ledger. |
| Locked LP | `CurveLpLocker` | Permanent. No function moves it — verify that stays true. |
| Holder reserve | `CurveHolderReserve` | Per-market reserve, paid pro rata from the frozen `held` ledger. |
| Keeper key | `KEEPER_PRIVATE_KEY` env | Sends permissionless txs. No funds at risk beyond gas, but a stuck/duplicated keeper breaks liveness. |
| Social DB | Supabase Postgres | All user content: profiles, follows, blocks, notes, reports, notifications. |
| Privy app secret | `PRIVY_APP_SECRET` | Mints the identity assertions the social service trusts. |
| Pinata JWT | `PINATA_JWT` | Server-side only. If it leaks, arbitrary IPFS uploads on Curveball's account. |

## The invariants that actually matter

The Foundry suite already asserts ten of these (`contracts/test/invariant/Invariants.t.sol`).
Your job is to find what the suite *doesn't* pin down. The invariants:

1. `launchpad.totalRealQuote() == Σ market.realQuote`, and WETH balance == that + surplus.
2. Curve reserves consistent; `sold <= CURVE_SUPPLY`; graduated ⇒ `realQuote == 0`.
3. Pre-graduation, the launchpad holds every unsold curve token.
4. Every escrow claim is backed by a balance already transferred in (`totalOwed` per asset).
5. The `held` ledger sums to sold, and pre-graduation bounds every real token balance.
6. Reserve claims never exceed the reserve.
7. Locker holds the LP; state machine cannot be skipped.
8. Pause scope: `launch`/`buy` only. Never sells, graduation, aborts, claims, buybacks.
9. Token supply: `1,000,000e18` flat; burned tokens are gone; no mint after initialize.
10. Fuzz runs must actually *reach* actions — most calls returning early proves nothing.

## Deliberate design decisions — do NOT report as bugs

Confirm each still holds in the code, but a violation of *intent* here is only a finding
if you can show concrete loss. Otherwise note it as "matches ADR 0003".

- **Pre-graduation transfer lock** (`CurveToken._beforeTokenTransfer`). Wallet-to-wallet
  transfers revert until `unlock()`. This is what keeps the graduation pool's token side
  empty and makes `held` equal real balances. Accepted cost: no router buys pre-graduation.
- **`buy` has no recipient parameter.** Curve tokens can only reach the payer. Deliberate.
- **Donations never block graduation.** WETH synced into a pre-created pool is matched
  with surplus tokens up to the burn buffer; above it the pool opens slightly higher at
  the donor's expense. "Nothing a donor does can make this revert" is the goal.
- **Stuck graduation aborts** after `GRADUATION_TIMEOUT` (7 days) in `Ready`. `Aborted` is
  sticky; sells reopen permanently. Graduation never checks Icarus's pause, so Icarus's
  pauser cannot force an abort — that is intentional.
- **Guardian pause is narrow.** Worst case is freezing new exposure until the timelocked
  owner unpauses. A guardian that can pause more than `launch`/`buy` IS a finding.
- **Reserve leftovers stay forever.** Rounding dust, unclaimed amounts, and the reserve of
  a market that never graduates are permanently stranded. By design.
- **Dust rules.** The final fill of a curve may pay no fee (`tokensOut == remaining`
  exemption in `quoteBuy`); curve sells reject fills whose fee rounds to 0.
- **Icarus is trusted for liveness and fees**, and its `feeManager` can divert up to half
  of LP fees to `gaugeFees` that Curveball can never claim. Accepted, monitored off-chain.
- **`MAX_RESERVE_TOKENS = (S−C)²/S`** is derived, not magic: it is the largest reserve
  for which the pool still gets enough tokens at the closing price.

## Where generic tools are blind

Slither sees Solidity only. It does not see, and cannot see:

- the **keeper's decision logic** (`keeper/graduation-keeper.mjs`) — a wrong decision
  table means markets never graduate or abort;
- the **indexer's reorg handling** (`services/social/src/indexer.mjs`) — the off-chain
  ledger diverging from chain state;
- the **social service's auth and authorization** (`privyAuth.mjs`, `server.mjs`);
- the **SQL construction** in `server.mjs`, including any identifier interpolated into a
  query string rather than passed as a parameter;
- the **IPFS/metadata fetch path** (`metadata.mjs`) and the Vercel API (`api/artwork.js`);
- **deployment/ops** posture: key handling, the `agent_wallet` file, Docker env wiring.

Prioritize those. A finding in the keeper's decide() or in an auth check is worth more
than the twentieth reentrancy-benign from Slither.

## Non-negotiables

- Never send a transaction to a live deployment, and never touch a key file. Read-only
  chain access (`cast call`, `cast logs`) is fine against testnet.
- Do not commit, edit, or "fix" anything in the repo during review unless explicitly asked.
  The deliverable is findings, not patches.
- Redact any secret you encounter in output. Report the *location* and *severity*, never
  the value.
