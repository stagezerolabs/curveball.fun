# Curveball

Curveball is a React/Vite dApp connected directly to the V2 Curveball contracts on RISE Testnet. Contract state and events remain the source for markets and transactions. The navbar also reads a connected wallet's primary `.rise` name from Stage0's RISE Mainnet API through a narrow same-origin proxy, with the address as a fallback.

## Testnet deployment

- Chain: RISE Testnet (`11155931`)
- RPC: `https://testnet.riselabs.xyz`
- Factory: `0xD0f0cf4fd5Aa9D391477B3B9CF3B77Dc96705056`
- Deployment block: `56629483`
- Launch fee: `0.0004 WETH` per token launch
- Launch fee treasury: `0x027ECdF183E064396701807E148BC474e01b7feb`
- Canonical deployment record: `deployments/11155931/curveball-v2-permissionless.json`

The frontend discovers launches from factory events, reads market state from the factory and curve contracts, and sends wallet-signed launch, trade, graduation, and fee-claim transactions through the SDK in `src/sdk`.

### Deploy the fee-enabled V2

The factory above was deployed on RISE Testnet on October 11, 2026. It charges a fixed `0.0004 WETH` per launch and sends it to an admin-owned fee treasury. For a fresh testnet deployment, run from the repository root:

```bash
make -C contracts deploy-v2-launch-fee-testnet
```

The command uses the local Foundry `dot` keystore by default. Set `ACCOUNT=<keystore-name>` if yours differs. It checks the chain, runs contract tests, asks you to type the deployment phrase, prompts for the keystore password, and saves the Forge output under `contracts/broadcast/DeployPermissionlessV2.s.sol/11155931/`. Do not send your password, private key, or keystore file. The previous no-fee factory remains recorded in `deployments/11155931/curveball-v2.json` for historical markets.

## Run locally

```bash
cp .env.example .env.local
bun install
bun run dev
```

Set `VITE_WALLETCONNECT_PROJECT_ID` to enable WalletConnect QR/mobile wallets. Injected browser wallets work without it.

To publish launch artwork, set `PINATA_JWT` in `.env.local` for local development and in the Vercel project's server environment for deployment. The JWT needs Pinata Files write permission. The upload endpoint verifies a fresh wallet signature, limits images to 2 MB, and stores the image and token metadata on public IPFS. The JWT is never sent to the browser. Markets resolve artwork from the metadata URI recorded in the launch event.

Vite proxies `/api/rns/primary/:address` to Stage0 during local development. The matching Vercel rewrite handles production. This identity lookup uses RISE Mainnet chain ID `4153` even when Curveball is connected to RISE Testnet; it never changes the wallet or transaction chain.

## Checks

```bash
bun run typecheck
bun test
bun run build
make -C contracts test
```

Contract deployment and other on-chain writes require the exact approval defined in `AGENTS.md`. Never commit private keys, keystore passwords, or RPC credentials.
