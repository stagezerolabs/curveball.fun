# Curveball fee and income model

Current deployment: fresh V1 on RISE Testnet, using a mock graduation venue. These are testnet accounting flows, not realized mainnet income. Historical V2 and V2.1 deployments are documented in the root `README.md`.

## Bonding-curve trades

Each launch snapshots its trading fee, fee split, creator tax, and treasury address from the factory. The active V1 factory defaults to a **75 bps (0.75%)** trading fee. Of that fee, **50% is credited to the creator, 25% funds the per-market buyback vault, and 25% is credited to the protocol treasury**. At the default rate, the treasury share is 18.75 bps of the trade's curve quote amount. Later factory policy changes affect new launches only.

The creator may select a separate **0–50 bps creator tax** at launch, subject to the current factory cap. The tax is added to the creator's fee credit; **it is not protocol revenue**. Buys pay the curve quote amount plus fee and tax. Sells receive the curve quote amount less fee and tax. `CurveBondingCurve._routeFees` transfers backed credits to `CurveFeeEscrow` and buyback funds to `CurveBuybackVault`.

Anyone can trigger an escrow claim, but the escrow pays the recorded recipient. Buyback funds stay assigned to their launch. A permitted sweep buys that launch's token on its curve, or on a compatible pool after graduation, subject to price and impact checks. Bought tokens vest over five years in lots; only the current factory owner can claim the vested amount. The mock graduation pool has no swaps, so it does not provide a usable post-graduation buyback venue.

## Launches and graduation

The deployed V1 mock factory has **no launch fee** (`launchFee == 0`). Its curve sells 80% of a fixed 1,000,000-token supply. Creators choose a 0–5% holder reserve (5% by default); that reserve reduces tokens assigned to the pool, not curve-sale tokens. The reserve is for creator-initiated, snapshot-based holder claims after graduation. It is not fee income.

When the curve sells out, the backend keeper prepares graduation and creates a pool at the venue snapshotted for that launch. The current mock venue creates an explorer-visible pool and locks LP tokens, but cannot execute swaps or earn swap fees. A future real venue may route collected pool fees to creator, treasury, and buyback recipients through the locker and hook; **no pool-swap income should be attributed to this mock release**.

The frontend's fee split graphic shows the configured allocation. It does not prove that fees have been paid or claimed. Testnet treasury and vault balances are balances, not lifetime revenue.

## Code sources

- `contracts/contracts/CurveV1Factory.sol`: active factory defaults, per-launch policy snapshot, reserve, and graduation.
- `contracts/contracts/CurveBondingCurve.sol`: buy/sell fee calculations and recipient routing.
- `contracts/contracts/CurveFeeEscrow.sol` and `CurveBuybackVault.sol`: claims, buybacks, and vesting.
- `contracts/scripts/DeployV1Mock.s.sol` and `deployments/11155931/curveball-v1-mock.json`: deployed mock configuration.
