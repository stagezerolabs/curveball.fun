# Curveball — how fees and income work now (V2)

Status: updated 2026-10-13. The deployed fee-enabled testnet factory still reads 50 bps until the separately approved on-chain update is confirmed. The 75 bps figures below describe the intended new-launch setting after that update. Two important frames up front:

- **Nothing earns real money today.** Everything runs on RISE testnet / a local fork. This is the model, not income.
- **Creators earn and the protocol earns from the same fee** — the split is fixed per token at launch.

## The main income source: bonding-curve trading fees

Curveball is a launchpad. Its income is **a fee on every trade** (buy and sell), charged on the quote leg (WETH), taken at the point of trade on the bonding curve.

**Default split (per launch, snapshotted at creation):**
- Curve fee: **75 bps** (0.75% of a trade) for new launches after the factory update. Earlier markets retain their launch-time fee.
- Split: **50% creator · 25% buyback · 25% protocol (treasury)**

At 75 bps, the **protocol's / operator's share = 25% of the fee = 18.75 bps (0.1875%) of curve trading volume**, in WETH. The creator gets half the fee; a quarter is forced into buyback of the token.

**Why the "buyback 25%" matters:** buyback is the second lever. The protocol owns and claims the **vested** buyback lots (each lot vests over 5 years; only the current protocol owner claims the vested portion). So buyback is both a token-supporting tool and a longer-term asset/authority the protocol controls rather than immediate income.

## How a token's split is fixed

At each launch the contract **snapshots** the fee, the three-way share, the **creator tax**, and the **treasury address** for that token. Nothing drifts after launch:
- `feeBps` — curve trade fee (new-deployment default 75 bps; each market snapshots the live factory value)
- `creatorShareBps` / `buybackShareBps` — creator and buyback cut of the fee (sum to the trade fee with the protocol's share)
- `creatorTaxBps` — a separate tax on the **creator**, default **0**, capped at **50 bps** (income only if Curveball sets a creator tax)
- treasury = the protocol address that receives the protocol share

The UI shows the same picture ("Where pool fees go" in the milestone panel: creator / treasury / buyback bars).

## Where fees land and who may claim

- **Pre-graduation:** fees collect on the curve as quote credits (`CurveFeeEscrow`) and buyback (`CurveBuybackVault`). **Claims are permissionless** — anyone can trigger one, but it **always pays the recorded recipient** (creator, treasury, or buyback vault).
- **Post-graduation (the Icarus pool = the AMM as the token graduates to free trading):** pool fees are claimed by the **LP locker** (the venue's liquidity controller), measured as real balance deltas, routed **in kind**.
- **Buybacks** are constrained (own curve/pool, 30-min price ref, 5% spot deviation, 2% impact) — the mechanic is bounded by design.

## Who has authority (why the protocol is the one earning)

On the currently deployed V2 factory, creators have no mint or token-reserve authority. The new, undeployed reserve-enabled factory keeps minting fixed and fee policy under protocol control, but lets each creator select a 0–5% holder airdrop reserve at launch. After graduation, the creator can allocate that reserve across snapshot-based claim rounds. They cannot withdraw it or redirect a holder's claim. The reserve is separate from trading fees and reduces token liquidity sent to the graduation pool.

## Income summary (ranked)

1. **Protocol share of trading fees** — 25% of each market's curve fee. At 75 bps, this is 18.75 bps of curve trading volume. *The main income source.*
2. **Creator tax** — a protocol-chosen tax on creators, off by default, up to 50 bps — pure protocol income when enabled.
3. **Buyback vested-lot ownership** — a locked, 5-year-vesting asset the protocol owns, claimable only by the current protocol owner (authority/asset, not near-term cash).
4. (Secondary) **LP locker claim** on post-graduation pool fees routed in kind.

## Honest caveat

This is the **code's** model — and the headline number (12.5 bps protocol share on all trades) is only real once there is mainnet volume. Today: RISE testnet and forks only, no public income, and launch is still permissionless/invitation-controlled per the recent V2 work.

---

_Sources: `docs/security/curveball-v2-review.md` (fee+buyback invariants, factory authority), `src/creatorTokens.ts` (markets tuple: feeBps/creatorShare/buybackShare/creatorTax), `src/components/MilestonePanel.tsx` (pool-fee split display), `src/sdk/contracts.ts` (treasury)._
