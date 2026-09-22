# RISE mainnet security review

> Historical mainnet evidence. The active application target is RISE Testnet; this report remains unchanged as an audit record for deployment `4153`.

Date: 2026-09-19

Scope: `CurveballLaunchpad`, `MemeToken`, `LpLocker`, production deployment/token scripts, SDK transaction boundaries, and the verified Icarus contracts used at graduation.

## Result

The repository's automated release gates pass. This is an engineering review, not an independent third-party audit. Deploying still exposes real funds to contract, upstream Icarus, RPC, key-custody, oracle-free pricing, and MEV risk.

## Automated evidence

- Foundry: 25/25 tests pass, including four tests against a current RISE mainnet fork. The fork suite creates an Icarus pool, deploys Curveball with the production script, creates NominateBear with the production script, graduates a market, and claims fees.
- Echidna: 20,123 calls; five properties pass. Sold supply remains bounded, active quote balances match accounting, virtual/real reserves remain consistent, the constant product never decreases, and graduation completes all wiring.
- ERC-20 conformance: all required ERC-20 functions and events pass `slither-check-erc`. The remaining generic approval-race advisory is addressed at the client boundary with exact-value approvals; users should still revoke abandoned approvals when practical.
- Icarus gate: `deployments/4153/icarus-verification.json` records verified source and live code hashes for the factory, implementation, and WETH; required ABI methods are present; the factory is unpaused; and the fork lifecycle passes.
- Diagrams: `contract-inheritance.svg`, `contract-call-surface.svg`, and `state-authorization.svg` document inheritance, external calls, and privileged state transitions.

## Slither triage

The machine-readable output is `slither-production.json`.

| Finding | Triage |
| --- | --- |
| Reentrancy around `_graduate` and the self-call from `buyTokens` | Accepted with controls. Buy, sell, and graduation entrypoints are guarded by `nonReentrant`; `graduateExternal` only accepts a call from the launchpad itself. Graduation only calls the verified factory/pool, the launchpad-created token, and the bound locker. A fork test exercises the complete call path. |
| Ignored `claimFees()` return value | Intentional. `LpLocker` measures token balance deltas before and after the call and pays only assets actually delivered; trusting the pool's return values would weaken this boundary. |
| Event emitted after graduation calls | Informational. The event represents completed graduation and is deliberately emitted only after all required state and external actions succeed. |
| Timestamp used for trade deadlines | Intentional. Timestamp is only an expiry bound supplied by the caller/SDK, not a source of price, randomness, or accounting. The SDK uses a five-minute deadline. |

The earlier zero-launchpad warning was fixed with an explicit constructor check and a regression test.

## Manual review

- Access: there is no launchpad owner or upgrade key. `LpLocker.owner` can bind the launchpad exactly once. The current treasury alone can hand treasury rights to a different non-zero address; it cannot change creator share or withdraw LP.
- Accounting: each active market's real quote balance is tracked separately; graduation zeroes its accounting only after liquidity is minted. A failed graduation becomes pending, preserves sell access, and can later retry.
- Token behavior: pre-graduation transfers are restricted to the launchpad. Trading unlocks permanently at graduation. Supply is fixed at creation. Fee-on-transfer and rebasing quote assets are unsupported; the production script hardcodes and identifies verified RISE WETH.
- Fee custody: anyone may trigger a fee claim, but recipients are fixed to the registered creator and current treasury. Pool identity must have been registered by the launchpad, and payouts use observed balance deltas.
- Upstream dependency: Icarus governance can pause its factory and change bounded fees. A pause can defer graduation, but does not prevent holders from selling back to an active curve. Existing Icarus pools and its governance remain external trust assumptions.
- MEV: trades are public and can be sandwiched. The SDK enforces a fresh quote, 3% minimum-output bound, and five-minute deadline; these reduce loss but do not provide private order flow or eliminate MEV.
- Metadata/privacy: the first token URI is immutable and public. No secret or user-private data belongs in token metadata. The endpoint content can change, so production hosting integrity is an operational dependency.
- Key custody: the encrypted `dot` keystore controls deployment, first-token creation, and initial treasury handoff. Its password and private key must never enter repository files, shell history, Koyeb, Netlify, or chat. Move treasury to a multisig promptly.

## Residual release conditions

The launchpad and locker were deployed at block `22216399`; both sources and all runtime configuration were verified afterward. Before creating NominateBear, deploy and check the metadata/API endpoint, then smoke-test the configured UI. A third-party audit is strongly recommended before encouraging meaningful public TVL.
