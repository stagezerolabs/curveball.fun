# Contract architecture

This directory contains two launch paths that share the token, bonding curve, fee custody, buyback, and holder reserve contracts. `CurveV1Factory` is the V1 path used by the mock-venue testnet deployment. `CurveLaunchFactory` is the V2 path wired directly to an Icarus-compatible factory. These are separate registries and deployments; a V1 launch does not become a V2 launch.

## Launch

1. A factory calls `CurveLaunchDeployer` to deploy a `CurveBondingCurve` and a fixed-supply `CurveLauncherToken`. The deployer mints the entire token supply once: the sellable portion and future pool liquidity go to the curve, while the selected holder reserve (0–5% of supply) goes to `CurveHolderReserve`.
2. The creator can call `createToken` directly or use `CurveLaunchAndBuy` to create and make the first curve purchase atomically. Launches are permissionless after the factory services are initialized (and, for V1, a venue is configured). The factory records the creator, curve, fee policy, treasury, and reserve size for each token.
3. The curve buys and sells against its virtual reserves in the configured ERC-20 quote asset. Trading fees and optional creator tax are credited to `CurveFeeEscrow` or `CurveBuybackVault`; claimable credits remain backed by transferred assets. Fee policy and the initial virtual reserve are fixed per launch. V1 also snapshots its selected venue per launch, so changing the factory's default venue affects only later launches.

## Graduation

Selling the entire curve allocation sets `sold == curveSupply`; it does **not** itself submit a graduation transaction. Anyone can call `graduate(token)` to run venue preflight and set `ready`. A failed preflight emits `GraduationDeferred` and leaves the curve ungraduated. Anyone can then call `createGraduatedPool(token)` to check again, release the curve's remaining token liquidity and quote proceeds, create or initialize a volatile pool, mint LP to the locker, and record the pool on the curve and holder reserve. A sell before pool creation clears `ready`, so the process must be retried after another sellout. The off-chain keeper in `../../keeper/` currently submits and retries these transactions for V1 launches; it does not support the V2 factory interface.

- **V1:** `CurveV1PoolAdapter` calls the selected Icarus-interface pool factory. `CurveV1Locker` receives LP and registers the pool. The testnet deployment script `../scripts/DeployV1Mock.s.sol` uses `MockIcarusFactory`; its pool is a mock and cannot serve as a production trading venue.
- **V2:** `CurveGraduationGuard` checks Icarus availability and pool readiness. `CurveGraduationExecutor` creates or initializes the Icarus pool, mints LP directly to `CurveLpLocker`, and registers it there.

The launcher token permits only curve transfers until the pool creation transaction. The factory enables general transfers in that transaction, and a revert rolls back the entire operation. Neither locker has a withdrawal path for registered pool LP; rescue functions reject it.

## After graduation

- The lockers expose permissionless `claim(pool)` calls for pool fees. Claimed amounts flow through `CurveMemeHook` under the launch's fee split into creator and protocol escrow credits plus buyback vault credits. These calls are not automatic.
- `CurveBuybackVault` can spend credited quote on the curve before graduation or on the pool afterward, subject to its time-weighted price, impact, and slippage checks. Bought tokens enter five-year vesting lots. Only the current factory owner can claim vested tokens. Sweeps and claims require separate transactions.
- After graduation, the creator can create holder-reserve rounds using a past block snapshot at or after the graduation block. Eligible holders can claim their proportional allocation; curve, pool, vault, and reserve balances are excluded from eligibility.

`CurveV2Deployment` and `CurveV1Deployment` wire the respective services. The V2 testnet deployment and later fee-controller handoff have separate scripts in `../scripts/`. Tests in `../test/` cover launch, trading, fee routing, graduation, reserves, and owner permissions.
