# Curveball — how fees and income work now (V2)

Status: 2026-10-06, read from the curveball.fun codebase (V2 contracts via `docs/security/curveball-v2-review.md`, the SDK, and the UI surfaces). Two important frames up front:

- **Nothing earns real money today.** Everything runs on RISE testnet / a local fork. This is the model, not income.
- **Creators earn and the protocol earns from the same fee** — the split is fixed per token at launch.

## The main income source: bonding-curve trading fees

Curveball is a launchpad. Its income is **a fee on every trade** (buy and sell), charged on the quote leg (WETH), taken at the point of trade on the bonding curve.

**Default split (per launch, snapshotted at creation):**
- Curve fee: **50 bps** (0.5% of a trade)
- Split: **50% creator · 25% buyback · 25% protocol (treasury)**

So the **protocol's / operator's main income = 25% of that 50 bps = 12.5 bps (0.125%) of every tradable volume**, in WETH. The creator gets half the fee; a quarter is forced into buyback of the token.

**Why the "buyback 25%" matters:** buyback is the second lever. The protocol owns and claims the **vested** buyback lots (each lot vests over 5 years; only the current protocol owner claims the vested portion). So buyback is both a token-supporting tool and a longer-term asset/authority the protocol controls rather than immediate income.

## How a token's split is fixed

At each launch the contract **snapshots** the fee, the three-way share, the **creator tax**, and the **treasury address** for that token. Nothing drifts after launch:
- `feeBps` — trade fee (default 50 bps)
- `creatorShareBps` / `buybackShareBps` — creator and buyback cut of the fee (sum to the trade fee with the protocol's share)
- `creatorTaxBps` — a separate tax on the **creator**, default **0**, capped at **50 bps** (income only if Curveball sets a creator tax)
- treasury = the protocol address that receives the protocol share

The UI shows the same picture ("Where pool fees go" in the milestone panel: creator / treasury / buyback bars).

## Where fees land and who may claim

- **Pre-graduation:** fees collect on the curve as quote credits (`CurveFeeEscrow`) and buyback (`CurveBuybackVault`). **Claims are permissionless** — anyone can trigger one, but it **always pays the recorded recipient** (creator, treasury, or buyback vault).
- **Post-graduation (the Icarus pool = the AMM as the token graduates to free trading):** pool fees are claimed by the **LP locker** (the venue's liquidity controller), measured as real balance deltas, routed **in kind**.
- **Buybacks** are constrained (own curve/pool, 30-min price ref, 5% spot deviation, 2% impact) — the mechanic is bounded by design.

## Who has authority (why the protocol is the one earning)

Per the V2 review: **creators have no mint, reserve, fee-policy, or graduation authority.** The **factory owns launch policy and invitation control**, and its one-time `initialize` binds every service and the locker + fee authorizations. So the fee shares and the treasury are protocol-owned parameters; creators get their half of the trade fee and can be taxed (creator tax), but can't reshape the model for their own tokens.

## Income summary (ranked)

1. **Protocol share of trading fees** — 25% of the (default 50 bps) curve fee, on all volume. *The main income source.*
2. **Creator tax** — a protocol-chosen tax on creators, off by default, up to 50 bps — pure protocol income when enabled.
3. **Buyback vested-lot ownership** — a locked, 5-year-vesting asset the protocol owns, claimable only by the current protocol owner (authority/asset, not near-term cash).
4. (Secondary) **LP locker claim** on post-graduation pool fees routed in kind.

## Honest caveat

This is the **code's** model — and the headline number (12.5 bps protocol share on all trades) is only real once there is mainnet volume. Today: RISE testnet and forks only, no public income, and launch is still permissionless/invitation-controlled per the recent V2 work.

---

_Sources: `docs/security/curveball-v2-review.md` (fee+buyback invariants, factory authority), `src/creatorTokens.ts` (markets tuple: feeBps/creatorShare/buybackShare/creatorTax), `src/components/MilestonePanel.tsx` (pool-fee split display), `src/sdk/contracts.ts` (treasury)._