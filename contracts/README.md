# Curveball Contracts

This directory contains the Solidity implementation, deployment wiring, mocks, tests, and the app's contract tooling.

## Scope

The in-scope production contracts are:

- `contracts/CurveLaunchpad.sol`
- `contracts/CurveToken.sol`
- `contracts/CurveFeeEscrow.sol`
- `contracts/CurveBuybackTreasury.sol`
- `contracts/CurveLpLocker.sol`
- `contracts/CurveIcarusSwapAdapter.sol` (separately deployed)
- `contracts/libraries/CurveMath.sol`
- `contracts/interfaces/ICurveLaunchpad.sol`
- `contracts/interfaces/ICurveSingletons.sol`
- `contracts/interfaces/IIcarus.sol`

The `scripts/CurveDeploy.sol`, `scripts/Deploy.s.sol`, and `scripts/DeployIcarusSwap.s.sol` files are included because constructor ordering, address prediction, singleton wiring, network parameters, and authority preflight checks are security-relevant. Everything under `test/` is supporting test code rather than production scope.

## Documentation

The auditor documentation starts at [`docs/README.md`](docs/README.md):

- [`docs/architecture.md`](docs/architecture.md) — topology, state ownership, lifecycle, roles, and asset flows.
- [`docs/protocol-spec.md`](docs/protocol-spec.md) — normative formulas and contract behavior.
- [`docs/integration-spec.md`](docs/integration-spec.md) — Icarus/WETH assumptions, deployment, and fork configuration.
- [`docs/security-and-invariants.md`](docs/security-and-invariants.md) — security properties, adversarial cases, and test evidence.
- [`docs/glossary.md`](docs/glossary.md) — canonical domain terminology.

## Toolchain

- Solidity: `0.8.24`
- EVM target: Shanghai
- Optimizer: enabled, 200 runs
- Test/build framework: Foundry
- Dependencies: OpenZeppelin Contracts `5.1.0`, Solady `0.1.26`, and forge-std `v1.17.0`

Install dependencies and run the local suite:

```sh
pnpm install --frozen-lockfile
make test
```

`make test` excludes fork tests and also builds with `forge build --sizes`.

## Fork tests

Fork tests exercise the live WETH and Icarus integrations at pinned blocks. They fail closed when invoked through the Make targets without the required RPC URL:

```sh
RISE_MAINNET_RPC_URL=<url> make test-fork-strict
RISE_TESTNET_RPC_URL=<url> make test-fork-testnet
```

The relevant network configuration is encoded in `scripts/Deploy.s.sol` and `test/fork/Lifecycle.fork.t.sol`:

| Network      | Chain ID | Icarus factory                               |
| ------------ | -------: | -------------------------------------------- |
| RISE mainnet |     4153 | `0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615` |
| RISE testnet | 11155931 | `0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9` |

Both configurations use WETH at `0x4200000000000000000000000000000000000006`.

`make smoke-testnet` broadcasts a smoke-token launch and a 0.003 WETH first buy against the recorded testnet launchpad. `Smoke.s.sol` supports the older five-argument launch ABI and the current four-argument ABI. Fund the broadcaster for the live launch fee, first-buy budget, and gas. Full sellout, graduation, a pool swap, and fee claims stay in the testnet fork smoke suite, which funds its actors with `vm.deal` and broadcasts nothing.

## Architecture and trust assumptions

`CurveLaunchpad` creates fixed-supply `CurveToken` clones, runs their bonding curves, and graduates sold-out markets into external Icarus volatile pools. `CurveFeeEscrow` accounts for creator and protocol fees and forwards the buyback share to `CurveBuybackTreasury`, which buys and burns only a timelock-selected graduated CURVE token. `CurveLpLocker` permanently holds LP positions and routes claimed fees to the escrow.

On RISE deployments, one wallet may buy and hold at most 40 million tokens from each 800 million-token curve (5%). Buys, including the optional launch first buy, stop at the remaining wallet capacity and leave unspent WETH in the wallet. Selling to the curve frees capacity; pool trading after graduation is unrestricted. This is an address limit, not a person or identity limit.

Curve buys pay an additional opening tax of 99%, 25%, 3%, 0.36%, and 0.04% of the curve quote at elapsed seconds 0–4; it is zero from second 5. This includes the optional buy inside `launch()`. Proceeds go directly to the treasury, separately from the base fee and creator tax. Curve sells and graduated pool swaps do not pay this opening tax.

The owner can update bounded defaults for future markets, unpause the launchpad, rotate the guardian, and rescue only surplus assets. The guardian can pause launches and buys. On mainnet, the deploy script creates a self-administered two-day timelock as owner. The `curveball` deployer is its proposer and executor and the launchpad guardian; the separately pinned treasury EOA receives protocol fees. Icarus and WETH are external dependencies and are not implemented in this repository; the interfaces, mocks, and fork tests document and exercise the behavior Curveball assumes from them.

## Excluded material

Compiler output, dependency directories, fuzz corpora, coverage reports, historical broadcasts, deployment caches, logs, and local hosting metadata are excluded because they are generated, stale, or reproducible from the included sources.

### CURVE activation

Launch CURVE through `CurveLaunchpad`, buy it out, and graduate it using the same flow as any market. The timelock then calls `CurveBuybackTreasury.setCurveToken(CURVE)` once; this permanently selects the only fee-funded buyback target. Fees accumulated before that call stay in the treasury. The keeper can then convert market-token LP fee shares to WETH and run global CURVE buybacks.

From the repository root, run `bun contracts/scripts/record-curve-activation.ts` with `CURVE_CHAIN_ID` and an HTTPS `CURVE_RPC_URL` to read the treasury's selected token, verify its launchpad pool, and write `deployments/<chainId>/curve-activation.json`. The script refuses to overwrite an existing record.
