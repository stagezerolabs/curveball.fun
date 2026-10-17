# Curveball

Curveball is a React/Vite launchpad for RISE Mainnet. The app reads one configured `CurveV1Factory`; deprecated factory versions, fallback deployments, and historical market discovery are not bundled.

## Production contracts

The current contracts launch a fixed 1,000,000-token supply, sell 800,000 tokens on a bonding curve, optionally reserve 0–5% for post-graduation holder rounds, and send the remaining tokens plus collected WETH to a volatile Icarus pool. LP tokens are permanently held by `CurveV1Locker`. Curve fees are split among the creator, protocol treasury, and per-market buyback vault. The 0.001 WETH launch fee is held by an owner-controlled `CurveLaunchFeeTreasury` deployed with the factory.

The production deployment record will live at `deployments/4153/curveball.json`. Until that record exists, `.env.production` intentionally has no factory address or deployment block and the production frontend must not be released.

### Testnet rehearsal

The testnet path deploys the same current contracts and 0.001 WETH launch-fee policy against canonical RISE Testnet WETH and the live Icarus testnet factory. It is restricted to chain `11155931` and the `dot` signer. It does not read or modify production configuration.

```bash
make testnet-preflight
make deploy-testnet ACCOUNT=dot
make record-testnet
make configure-testnet
```

The broadcast submits all ten contracts to the RISE Testnet Blockscout verifier. Recording validates every receipt, service address, policy value, bytecode hash, and verified source before writing `deployments/11155931/curveball.json`. Configuration then updates the shared ignored `.env` so the local UI uses the fresh testnet factory and deployment block.

### Mainnet deployment

Copy `.env.example` to the repository-level `.env` and set the deployment values. Use a private RISE Mainnet RPC endpoint. `OWNER_ADDRESS` must equal `DEPLOYER_ADDRESS` for the initial deployment; ownership can be transferred with the factory's two-step handoff after verification.

```bash
make production-preflight
make deploy-production
CONFIRM_RECORD_PRODUCTION=RECORD_CURVEBALL_RISE_MAINNET_4153 make record-production
make configure-production
```

The preflight runs the full Foundry suite, bytecode limits, a complete launch/graduation lifecycle on a fresh RISE Mainnet fork, and a dry-run of the production deployment. The broadcast script is restricted to chain `4153`, canonical RISE WETH, the reviewed Icarus factory, and a 0.001 WETH launch fee. It deploys a recoverable launch-fee treasury owned by the deployer and submits all ten contracts for Blockscout verification. Recording re-reads all service wiring and policy from the live chain and requires every deployed source to be verified before writing the deployment artifact. Configuration then points `.env.production` at that verified factory.

After recording, set the same factory and deployment block in Vercel and the graduation keeper. Do not copy deployment credentials, keystore passwords, or keeper keys into any `VITE_` variable.

## Graduation keeper

The standalone worker in [`keeper/`](keeper/README.md) discovers launches and submits the two permissionless graduation transactions. Run one monitored instance with a dedicated, funded mainnet wallet. Its factory and deployment block must match the production deployment record.

## Run locally

```bash
cp .env.example .env.local
bun install
bun run dev
```

Set `VITE_LAUNCHPAD_ADDRESS` and `VITE_DEPLOYMENT_BLOCK` to the deployment you want to inspect. Set `VITE_WALLETCONNECT_PROJECT_ID` for QR/mobile wallets. Injected browser wallets work without it.

Artwork uploads require a server-only `PINATA_JWT` with Pinata Files write permission. Never prefix it with `VITE_`. Apply an edge rate limit to `/api/artwork` before opening public uploads.

## Checks

```bash
bun run typecheck
bun test
bun run build
make -C contracts test
```

Never commit private keys, seed phrases, keystore passwords, or credential-bearing RPC URLs.
