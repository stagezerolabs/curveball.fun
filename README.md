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
The production frontend launches through the fee-enabled factory above and still discovers and services markets from the previous V2 factory (`0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf`).

## Trading fee administration

The fee-enabled factory has an owner-controlled curve trading fee. The checked-in contract default for **new deployments** is 75 bps (0.75%). The already deployed factory retains its on-chain value until its owner changes it; changing source code or deploying the frontend does not change contract state. Each market snapshots its trading fee at launch, so changes affect future launches only. Icarus pool swap fees after graduation are separate.

The designated dashboard wallet is `0x5cc42e772f67089b4670eec4dcd904be2f2d511c`. Connect it on RISE Testnet and open `/admin` to see the live fee, owner, and other fee defaults. It can update the fee while it directly owns the factory, or after a dot-owned fee controller becomes the factory owner. The controller delegates only trading-fee changes to this wallet and reads the other four defaults from the factory in the same transaction. Dot owns the controller and can revoke the delegate, change all factory policy, or transfer factory ownership. The dashboard checks the confirmed on-chain result.

The dashboard also reads live WETH balances for the trading-fee treasury, the separate launch-fee treasury, and the buyback vault. These are wallet and contract balances, not lifetime fee totals.

The fee update to 75 bps was confirmed on RISE Testnet in transaction `0xd4a3abbe31fe92fe65f7d70cceadf08994af6c6f9b478b7c4940da9bae67c8b6`. The designated dashboard wallet subsequently accepted direct factory ownership. Dot therefore has no factory authority until the controller handoff below completes. The controller changes factory ownership, including rescue authority and vested buyback claims; it does not transfer the separately owned launch-fee treasury or change the recorded trading-fee treasury address.

To keep dot as super admin while the designated wallet edits trading fees:

1. Dot runs `make deploy-fee-controller-testnet` from the repository root in an interactive terminal and records the printed controller address. The command verifies RISE Testnet, runs controller tests, asks for a confirmation phrase, and uses the local Foundry `dot` keystore.
2. The designated wallet opens `/admin`, enters that controller address under **Keep dot as super admin**, reviews it, and confirms the wallet transaction. The dashboard verifies the controller is bound to this factory, owned by dot, and delegates fee editing to the designated wallet before nominating it.
3. Dot runs `make accept-fee-controller-testnet CONTROLLER=0x...` in an interactive terminal. The command checks the pending transfer, simulates acceptance, asks for confirmation, and verifies the final owner. It uses the `dot` keystore by default; pass `ACCOUNT=<keystore-name>` if that account has another local name.

No existing factory redeployment is needed. Each on-chain command above is run by the user; Codex-run writes require the exact approval specified in `AGENTS.md`.

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

To publish launch artwork, set `PINATA_JWT` in `.env.local` for local development and in the Vercel project's server environment for deployment. The JWT needs Pinata Files write permission. Selecting an image starts a background upload to public IPFS. Once the token name and ticker are valid, the app publishes metadata that points to that image. Launch stays disabled until the metadata URI is ready, and that URI is passed to the launch contract. Artwork publishing does not ask for a wallet signature; the wallet only prompts for launch transactions. The JWT stays on the server, and the endpoint limits images to 2 MB. Markets resolve artwork from the metadata URI recorded in the launch event. Apply a rate limit to `/api/artwork` at the hosting edge before opening public uploads, since origin checks alone do not prevent scripted use of the Pinata allowance.

Vite proxies `/api/rns/primary/:address` to Stage0 during local development. The matching Vercel rewrite handles production. This identity lookup uses RISE Mainnet chain ID `4153` even when Curveball is connected to RISE Testnet; it never changes the wallet or transaction chain.

## Checks

```bash
bun run typecheck
bun test
bun run build
make -C contracts test
```

Contract deployment and other on-chain writes require the exact approval defined in `AGENTS.md`. Never commit private keys, keystore passwords, or RPC credentials.
