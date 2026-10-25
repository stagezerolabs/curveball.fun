# Replace the V1 service mesh with a lean singleton launchpad

Curveball's contracts move from twelve wired service contracts plus two per-launch deployments to one `CurveLaunchpad` singleton that holds every market's virtual-reserve curve. The other pieces are:

- an EIP-1167 `CurveToken` clone per launch;
- a `CurveFeeEscrow` that owns the single fee split, the pull claims and a pool-only buyback that burns what it buys;
- a `CurveLpLocker` that holds graduated LP forever;
- a `CurveHolderReserve` that pays the reserve pro rata from an on-chain `held` ledger.

Graduation creates the Icarus pool directly through an immutable factory, so no venue or setter can redirect a raise. The pool is seeded at the curve's closing price: reserves are capped at `(S−C)²/S`, and the surplus tokens are burned. Nothing was deployed on RISE mainnet, so the rewrite breaks the V1 ABI. The frontend, keeper and indexer move to the new one in the same change.

Decisions and the trust assumptions they leave:

- **Transfer lock.** Curve tokens can't move between wallets until graduation. `buy` has no recipient. This keeps the pool's token side empty before graduation and makes `held` equal real balances, at the cost of wallet-to-wallet transfers and router buys before graduation.
- **Donations never block graduation.** WETH synced into a pre-created pool is matched with surplus tokens up to the burn buffer. Above that buffer, the pool opens at a premium paid by the donor.
- **Stuck graduations abort.** After `GRADUATION_TIMEOUT` (7 days) in `Ready`, anyone can abort, or the next `sell` aborts it inline. `Aborted` is sticky and sells stay open. Graduation does not check Icarus's pause, so Icarus's pauser can't force aborts.
- **Owner.** The owner is a multisig behind an OZ `TimelockController`, and `renounceOwnership` reverts. The owner can bound new-launch fees (≤ 200 bps, tax ≤ 50 bps), set the graduation target, unpause, rotate the guardian and rescue only unowed balances.
- **Guardian pause.** A non-timelocked guardian multisig can pause `launch` and `buy` instantly. It can never pause sells, graduation, aborts, claims or buybacks. Worst case: a compromised guardian freezes new exposure until the timelocked unpause.
- **Treasury.** The treasury is an immutable Safe. Its signers rotate inside the Safe, not in the contracts.
- **Icarus is trusted for liveness and fees.** Its `feeManager` can divert up to half of LP fees to `gaugeFees`, which Curveball can't claim. The indexer polls each graduated pool's fee and unstaked fee and alerts on change.
- **Holder reserve leftovers.** Rounding dust, unclaimed amounts and the reserve of a market that never graduates stay in `CurveHolderReserve` permanently.
- **Buyback pacing.** Each buyback spends at most 0.25% of the pool's quote reserve, at most hourly, and only within 1% of the fee-adjusted TWAP; otherwise it skips. The 25% chunk is geometric, so a balance only empties through the dust rule (spend all once a chunk rounds to 0). On a pool created before graduation, a donation synced before graduation can still sit in one TWAP window; the impact cap bounds what a sandwich can take from that.
- **Dust.** The final fill of a curve may pay no fee, so a dust remainder can't block sellout. Curve sells still reject fills whose fee rounds to 0; a dust position becomes transferable after graduation.
- **Locker strays.** Tokens sent to `CurveLpLocker` by mistake stay there; it has no rescue, so nothing can ever move LP out.
- **Quote.** The quote token is plain 18-decimal WETH (`0x4200…0006`). There are no native-ETH paths and no `receive`.
- **Size fallback.** If `CurveLaunchpad` can't keep 2 KB under EIP-170 once graduation is written, graduation moves to a stateless `CurveGraduator`. The launchpad keeps the registry, the curve state and the unlock.
