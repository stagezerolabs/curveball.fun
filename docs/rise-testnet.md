# RISE Testnet deployment

Curveball's active environment is RISE Testnet (`11155931`). The RISE mainnet deployment and its security evidence remain archived under `deployments/4153` and `docs/security/mainnet-security-review.md`.

## Network and dependencies

| Item | Value |
| --- | --- |
| RPC | `https://testnet.riselabs.xyz` |
| Explorer | `https://explorer.testnet.riselabs.xyz` |
| WETH | `0x4200000000000000000000000000000000000006` |
| Icarus PoolFactory | `0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9` |
| Icarus pool implementation | `0x74309f2134DA3E920094A5B0d5DF5d5Dcd1942b1` |

The Icarus testnet factory is published by the Icarus application and passes Curveball's full fork lifecycle. Its factory and implementation source are not verified on Blockscout or Sourcify. Run the read-only gate before any deployment:

```sh
RISE_TESTNET_RPC_URL=https://testnet.riselabs.xyz make -C contracts verify-icarus-testnet
```

The generated evidence, including pinned bytecode hashes and the accepted testnet risk, is stored in `deployments/11155931/icarus-verification.json`.

## Contract deployment

The deployment uses the encrypted local Foundry account `dot`. Never put its password or private key in an environment variable, command argument, repository file, Koyeb, Netlify, or Neon.

```sh
cd contracts
make simulate-testnet \
  TESTNET_RPC_URL=https://testnet.riselabs.xyz \
  TREASURY=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3

make deploy-testnet \
  TESTNET_RPC_URL=https://testnet.riselabs.xyz \
  BLOCKSCOUT_API=https://explorer.testnet.riselabs.xyz/api \
  CONFIRM_TESTNET=DEPLOY_CURVEBALL_RISE_TESTNET_11155931 \
  TREASURY=0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3

make record-testnet TESTNET_RPC_URL=https://testnet.riselabs.xyz
```

The canonical deployment is recorded in `deployments/11155931/curveball.json`:

- Launchpad: `0x1A34768eAb2F6b925D25ca1d6daC03C1a25Ad39E`
- LP locker: `0xFC301f5349EB1ee9F12E8d6d446Ce5e526984782`
- Deployment block: `55002177`

Both Curveball contracts are source-verified on RISE Testnet Blockscout. The launchpad happens to share its hexadecimal address with the archived mainnet deployment because the same deployer nonce was used; clients must also enforce chain ID `11155931`.

## Data and hosting

- Neon project: `curveball-testnet` (`dry-dew-99165555`), with a fresh database and no copied mainnet rows.
- Koyeb API: `curveball/api`; deployment `72e11c3e-4bc8-4d0a-9ce7-6737bbe33e4a` is active and its health endpoint reports chain `11155931`. Its testnet database and RPC are stored as `curveball_testnet_database_url` and `curveball_testnet_rpc_url`.
- Netlify site: [`curveball-fun`](https://curveball-fun.netlify.app) (`98c3e594-e664-4fc9-b8c2-e3b0e876d003`), production deploy `6ab2a14829720728c733430d`.
- Run exactly one indexer replica from the launchpad deployment block. The existing free Koyeb web instance sleeps and cannot provide reliable indexing; use an always-on worker when the account plan permits it.

The API and UI are deployed. `/api/health` returns `{ "ok": true, "chainId": 11155931 }`, including through Netlify's `/api/*` proxy. The rendered home and Launch pages pass a browser smoke check.

Continuous indexing is not yet available: the Koyeb account's free web instance sleeps and cannot host an always-on worker. Authorize a paid Koyeb worker or choose another always-on host before relying on automatic market discovery.

## Smoke test

Create `Curveball Testnet Smoke` (`CBT`) with an empty metadata URI through the frontend. Buy `0.01 WETH`, sell the received tokens, and confirm that both transactions appear in the testnet explorer, indexer, API, and UI.
