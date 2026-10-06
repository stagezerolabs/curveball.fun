# Permissionless launch rewrite

## Objective

Every connected wallet can create a token and buy on an open curve. Keep the existing fixed supply, bonding curve pricing, fee split, creator tax cap, launch-and-buy path, and graduation mechanics. The new factory must be public from deployment, without an owner action to open launches.

## Contract boundary

- Direct `createToken` and wrapper `createFor` accept any nonzero creator once services are initialized.
- Buying has no invitation check. Market state, slippage, deadline, balance, and graduation guards remain.
- Factory-only deployment, wrapper-only `createFor`, fee bounds, owner-only configuration and rescue, and per-market policy snapshots remain.
- The factory bounds on-chain name, symbol, and metadata URI byte lengths to avoid unbounded public launch payloads. SDK validation remains stricter for wallet users.
- Retain compatible `LaunchCreated` and trading/graduation events so existing SDK and indexer decoders can process a new deployment.
- The existing deployed factory is immutable and stays gated until separately opened; this source change only affects a new deployment.

## Experience boundary

- The launch page shows a centered, two-part form with explicit required fields and wallet connection as the first action when disconnected.
- A permissionless deployment never asks for an invitation. A legacy gated deployment must still report its actual access state rather than promise an available launch.
- The transaction dialog reports actual wallet and chain stages. A confirmed token appears in Markets before the indexer finishes, then the page redirects there.
- Buying remains blocked only by wallet disconnection or the market's sold-out, ready, or graduated state on a permissionless deployment.
- Every connect action opens RainbowKit's wallet picker. A configured WalletConnect project ID enables QR and mobile wallets alongside browser extensions; connected users can manage or disconnect their wallet from the profile page.

## Activation and data

- A new deployment address and start block are required. Source changes do not alter the deployed V2 factory.
- SDK, API, indexer, and browser must all point at the same new factory before activation.
- Deployment, on-chain transactions, and database migrations require separate exact command approval under AGENTS.md.
- Markets starts fresh at the new factory. The API filters V2 tokens by the active `LAUNCHPAD_ADDRESS`; old factory rows remain in the database but are not shown or routed through the new app.
- No database deletion is required for the fresh market list. Existing on-chain markets remain at their original address outside this new view.

## Acceptance

1. Foundry tests show an arbitrary uninvited wallet creating and buying, including launch-and-buy, while safety invariants still pass.
2. Frontend tests show a connected wallet able to submit on a public deployment and the correct blocked states for the old gated deployment.
3. Typecheck, frontend build, contract tests, and local integration checks pass.
4. No production deployment or migration occurs during implementation.
