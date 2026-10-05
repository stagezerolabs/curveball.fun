# Mainnet SDK and launch specification

> Historical record: Curveball's active deployment target moved to RISE Testnet on 2026-09-22. Do not use the addresses or release commands below for the active application.

## Objective

Ship a typed frontend SDK as the only browser-side interface to Curveball's RISE contracts, remove all demo/mock data paths, verify and deploy the production contracts on RISE mainnet, then create the first live token.

## Locked production inputs

- Chain: RISE mainnet (`4153`)
- Classic Icarus PoolFactory: `0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615`
- Quote asset: verified RISE WETH (address must pass the deployment gate)
- Deployer, temporary treasury, and first-token creator: encrypted Foundry account `dot`
- Supply: `1,000,000e18`
- Bonding-curve allocation: `800,000e18`
- Initial virtual quote reserve: `10e18`
- Creator fee share: `5,000` bps; treasury receives the other 50%
- First token: `NominateBear` (`NBR`)
- Metadata URI: stable Curveball production API URL for NominateBear metadata; no fake token or market data
- Runtime: static frontend plus Bun API/indexer on Koyeb and production Postgres

The `dot` address is `0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3` and is resolved from its encrypted keystore at the deployment gate. No private key or password is stored in the repository or application environment.

## Public seams under test

1. SDK API: configuration validation, deployment validation, reads, quotes, approvals, create/buy/sell/claim writes, receipt parsing, and normalized errors.
2. Contract boundary: Foundry unit/invariant tests and a live RISE fork covering creation, trading, graduation, and fee claims.
3. UI boundary: launch and trade flows consume the SDK only, reject the wrong chain, expose transaction states, and never substitute mock data.
4. Data boundary: indexer/API expose only indexed production-chain data through Postgres; empty and unavailable states remain explicit.

## Functional requirements

- A single typed SDK owns chain configuration, ABIs, address validation, read/write calls, allowance handling, slippage, deadlines, receipt parsing, and wallet-chain enforcement.
- UI state and components do not import ABIs or call Wagmi/Viem contract actions directly.
- Creating a token returns the address decoded from `TokenCreated` and links the user to the live market/explorer.
- Buys and sells use fresh on-chain quotes, exact approvals, configurable slippage, five-minute deadlines, receipt confirmation, and clear revert/wallet errors.
- Fee claims validate the locker and pool addresses exposed by the live launchpad configuration.
- Production startup fails closed when chain ID, contract address, bytecode, or immutable deployment configuration differs from the expected values.
- No runtime references to demo fixtures, fallback token lists, mock candles, mock holders, mock positions, or mock trades remain.
- `/api/metadata/nominatebear` serves real production metadata for the immutable first-token URI.

## Mainnet deployment gates

No broadcast occurs unless every gate passes:

1. Full Foundry, Bun, typecheck, and production-build suites are green.
2. Slither findings are fixed or explicitly triaged; ERC checks and security diagrams are reviewed.
3. Curve state/access/arithmetic/external-call invariants are documented and exercised with Echidna/Foundry invariants.
4. Official Icarus address, verified source, ABI surface, implementation, WETH identity, code hashes, and live-fork lifecycle are revalidated immediately before deployment.
5. Deployment is simulated against a fresh RISE fork and expected immutable configuration is asserted.
6. The deployment command requires chain `4153`, an explicit mainnet confirmation token, the `dot` keystore, and an interactive signing prompt.
7. Deployed source is verified on the RISE explorer and runtime bytecode/configuration are read back.
8. The UI/API/indexer configuration is updated to the verified launchpad address and production smoke checks pass.
9. Only then is `NominateBear` created through the SDK using `dot`; its receipt and indexed API record are verified.

## Explicit boundaries

- Koyeb account/resource creation and secret entry remain operator actions; repository configuration and health checks are included.
- `dot` controls a narrowly scoped `LpLocker.setTreasury` handoff. Moving fees to a multisig later is a one-step SDK/contract transaction; only the current treasury may perform it, and it cannot set the zero address.
- The contracts are non-upgradeable. Any incorrect immutable address or economic input requires redeployment.
- The NominateBear URI is immutable in the token. The stable HTTPS endpoint may update its JSON, but the URI itself cannot change.

## Acceptance criteria

- All approved test seams pass without internal-module mocks.
- `rg` finds no production import or execution path referencing mock/demo market data.
- The SDK is the sole browser contract integration layer.
- Mainnet deployment and token creation receipts succeed and are explorer-verifiable.
- The indexer discovers NominateBear and every UI market/trade value comes from the API or live chain.

## Live deployment

- Block: `22216399`
- Launchpad: `0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E`
- LP locker: `0xFC301f5349EB1ee9F12E8d6d446Ce5e526984782`
- Deployer and initial treasury: `0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3`
- Both contracts are source-verified on RISE Blockscout.
- NominateBear creation remains gated on the production metadata/API deployment.
