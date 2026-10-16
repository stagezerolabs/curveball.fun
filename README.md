# Curveball

Curveball is a React/Vite dApp connected directly to the configured Curveball contracts on RISE. Contract state and events remain the source for markets and transactions. The navbar also reads a connected wallet's primary `.rise` name from Stage0's RISE Mainnet API through a narrow same-origin proxy, with the address as a fallback.

## Previous testnet deployment (reference)

The previous `CurveV1Factory` was deployed at `0x3F1eaFBfa954936b4671CC40c89871808C12f392` on RISE Testnet, starting at block `57060749`. It starts with a **0.005 WETH graduation target**, sells 800,000 of 1,000,000 tokens on the curve, and sends the collected WETH plus remaining pool tokens to a mock venue. The mock creates and locks LP tokens but offers no swaps. Its 0.005 WETH target is pool proceeds; buyers also pay the curve fee and any selected creator tax. The deployment record is `deployments/11155931/curveball-v1-mock.json`.

Each launch records its own virtual reserve and venue adapter. Dot can call `setGraduationTarget(uint256)` and `setVenue(address)` on the V1 factory; changes affect future launches only. The adapter must match the factory, WETH, and LP locker. A later adapter can point at the real Icarus factory. The factory uses two-step ownership transfer for a future multisig.

The initial V1 deployment used the local Foundry `dot` keystore with:

```bash
make deploy-v1-mock-testnet
```

The app reads only the configured `VITE_LAUNCHPAD_ADDRESS` from `VITE_DEPLOYMENT_BLOCK`. Set both values from the fresh deployment before building the frontend. Configure the keeper with the same fresh factory and block. Do not reuse this earlier deployment.

### Automatic graduation keeper

The standalone Node.js worker is in [`keeper/`](keeper/README.md). Deploy that folder to a VPS, configure the server-only `KEEPER_*` variables in `keeper/.env.example`, and run one continuously running instance with a dedicated wallet funded for gas. It does not start with the Vite app or the Vercel frontend deployment.

The keeper scans `LaunchCreated` events from `KEEPER_DEPLOYMENT_BLOCK`, then checks active curves every `KEEPER_POLL_INTERVAL_MS` (10 seconds by default). When `sold == curveSupply`, it calls `graduate(token)` and, once the venue is ready, `createGraduatedPool(token)`. It rechecks chain state before pool creation, waits for receipts, and retries deferred graduations after a cooldown. Monitor its logs for repeated deferrals or RPC failures.

Users see **Bonding complete** while the pool is being prepared. The market page checks for the on-chain transition and shows a link to the confirmed pool address when `graduated` becomes true. This release uses a mock venue: its pool is an explorer-visible test artifact and does not support swaps.

The frontend discovers launches from the configured factory's events, reads market state from that factory and its curves, and sends wallet-signed transactions through the SDK in `src/sdk`. Deprecated factory versions and fallback deployment paths are not bundled into the app.

## Run locally

```bash
cp .env.example .env.local
bun install
bun run dev
```

Set `VITE_WALLETCONNECT_PROJECT_ID` to enable WalletConnect QR/mobile wallets. Injected browser wallets work without it.

To publish launch artwork, set `PINATA_JWT` in `.env.local` for local development and in the Vercel project's server environment for deployment. The JWT needs Pinata Files write permission. Selecting an image starts a background upload to public IPFS. Once the token name and ticker are valid, the app publishes metadata that points to that image. Launch stays disabled until the metadata URI is ready, and that URI is passed to the launch contract. Artwork publishing does not ask for a wallet signature; the wallet only prompts for launch transactions. The JWT stays on the server, and the endpoint limits images to 2 MB. Markets resolve artwork from the metadata URI recorded in the launch event. Apply a rate limit to `/api/artwork` at the hosting edge before opening public uploads, since origin checks alone do not prevent scripted use of the Pinata allowance.

Vite proxies `/api/rns/primary/:address` to Stage0 during local development. The matching Vercel rewrite handles production. This identity lookup uses RISE Mainnet chain ID `4153` even when Curveball is connected to RISE Testnet; it never changes the wallet or transaction chain.

## Checks

```bash
bun run typecheck
bun test
bun run build
make -C contracts test
```

Never commit private keys, keystore passwords, or RPC credentials.
