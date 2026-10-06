# Curveball

Curveball is a static React/Vite dApp connected directly to the V2 Curveball contracts on RISE Testnet. Contract state and events are the application data source; no other application services are required.

## Testnet deployment

- Chain: RISE Testnet (`11155931`)
- RPC: `https://testnet.riselabs.xyz`
- Factory: `0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf`
- Deployment block: `55636468`
- Canonical deployment record: `deployments/11155931/curveball-v2.json`

The frontend discovers launches from factory events, reads market state from the factory and curve contracts, and sends wallet-signed launch, trade, graduation, and fee-claim transactions through the SDK in `src/sdk`.

## Run locally

```bash
cp .env.example .env.local
bun install
bun run dev
```

Set `VITE_WALLETCONNECT_PROJECT_ID` to enable WalletConnect QR/mobile wallets. Injected browser wallets work without it.

## Checks

```bash
bun run typecheck
bun test
bun run build
make -C contracts test
```

Contract deployment and other on-chain writes require the exact approval defined in `AGENTS.md`. Never commit private keys, keystore passwords, or RPC credentials.
