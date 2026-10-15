# Curveball

Curveball is a React/Vite dApp connected directly to V2.1 Curveball contracts on RISE Testnet. Contract state and events remain the source for markets and transactions. The navbar also reads a connected wallet's primary `.rise` name from Stage0's RISE Mainnet API through a narrow same-origin proxy, with the address as a fallback.

## Testnet deployment

- Chain: RISE Testnet (`11155931`)
- RPC: `https://testnet.riselabs.xyz`
- Active V2.1 factory: `0x6c12CCE962944EbB6A28536eD23baeFAa15c79cD`
- Holder reserve: `0x06791a55D94B7EA697C00E2B33bA2F16A9160999`
- Fee controller: `0x5f4a91DC59ed15fFEf30dbf3c591089132Df8831`
- Deployment block: `56985934`
- Launch fee: `0.0004 WETH` per token launch
- Launch fee treasury: `0x5Dd6890a17c8652DA24A0Aff5746f0A996B95BE4`
- Canonical deployment record: `deployments/11155931/curveball-v2.1-holder-reserve.json`

The frontend discovers launches from factory events, reads market state from the factory and curve contracts, and sends wallet-signed launch, trade, graduation, and fee-claim transactions through the SDK in `src/sdk`.
New launches use V2.1. Market discovery, trading, and graduation still work for tokens from the original V2 factory (`0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf`) and the fee-enabled V2 factory (`0xD0f0cf4fd5Aa9D391477B3B9CF3B77Dc96705056`). The market list shows and filters by factory version. Each market action uses the factory that launched that token.

## Holder airdrop reserve (V2.1)

V2.1 is deployed on RISE Testnet. Existing V2 tokens retain their original supply and cannot gain a holder reserve. On another chain, set `VITE_LEGACY_LAUNCHPAD_ADDRESS` and `VITE_LEGACY_DEPLOYMENT_BLOCK` to keep a previous factory in discovery.

New launches default to a 5% holder reserve; creators can choose 0–5%. The 80% curve sale remains fixed, and the chosen reserve reduces the 20% otherwise provided to the graduation pool. Reserve tokens remain in `CurveHolderReserve`. After graduation, the recorded creator can commit them across multiple rounds using a past block after graduation. Claims are proportional to checkpointed balances at that block. The curve, liquidity pool, reserve contract, and buyback vault are excluded; the creator qualifies if their wallet holds tokens. Any wallet can submit a claim, but tokens always go to the eligible holder. Claims have no expiry. Rounding dust remains in the reserve contract. Balance checkpoint writes add gas to token transfers.

The V2.1 deployment was signed locally on October 15, 2026. Its transactions, service addresses, code hashes, and creation block are in the canonical deployment record. Do not rerun the deployment command against the same release.

## Trading fee administration

V2.1 has a 75 bps (0.75%) curve trading fee. Its factory is owned by the V2.1 fee controller. Dot owns that controller as super admin, and `0x5cc42e772f67089b4670eec4dcd904be2f2d511c` is the delegated fee admin. The `/admin` dashboard recognizes the reviewed controller code and lets either authorized wallet edit the trading fee. The prior V2 controller remains bound to its own factory. Each market snapshots its trading fee at launch, so changes affect future launches only. Icarus pool swap fees after graduation are separate.

The controller delegates only trading-fee changes to the fee admin wallet and reads the other factory defaults in the same transaction. Dot can revoke the delegate, change all factory policy, or transfer factory ownership. The dashboard checks the confirmed on-chain result.

The dashboard also reads live WETH balances for the trading-fee treasury, the separate launch-fee treasury, and the buyback vault. These are wallet and contract balances, not lifetime fee totals.

The V2.1 controller deployment, ownership nomination, and acceptance are recorded in `deployments/11155931/curveball-v2.1-fee-controller.json`. The earlier V2 controller and its history remain in `deployments/11155931/curveball-fee-controller.json`. Controllers hold factory authority, including rescue authority and vested buyback claims. They do not control the separately owned launch-fee treasury.

The V2.1 deployment and controller handoff commands have completed for this release. Do not rerun them against these addresses.

### Deploy the fee-enabled V2

The earlier fee-enabled V2 factory was deployed on RISE Testnet on October 11, 2026. It charges a fixed `0.0004 WETH` per launch and sends it to an admin-owned fee treasury. For a fresh testnet deployment, run from the repository root:

```bash
make -C contracts deploy-v2-launch-fee-testnet
```

The historical command uses the local Foundry `dot` keystore by default. Set `ACCOUNT=<keystore-name>` if yours differs. Its existing broadcast guard prevents accidentally overwriting the recorded fee-enabled deployment. Do not send your password, private key, or keystore file. The earlier no-fee factory is recorded in `deployments/11155931/curveball-v2-early.json`.

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
