# Token-funded testnet beta review

Scope: the isolated mUSDC → mWETH fixed-rate venue, adapter, V2 factory binding, and curve payer extension. The assets are testnet mocks with no redemption claim.

- **Signer and recipient:** `buyWithToken` pulls mUSDC from `msg.sender`; the curve output is sent to that same address. A caller cannot choose a third-party recipient. Only the factory owner can bind or pause the adapter.
- **Ownership and market validation:** the adapter checks the factory's live binding and pause flag, and resolves the curve from that factory's market mapping. The factory validates the adapter's immutable factory and quote when binding it.
- **External calls and reentrancy:** input and quote contracts and the venue are immutable. The adapter, venue, and curve guard their state-changing trade entry points. There is no user-provided call target or arbitrary CPI equivalent.
- **Arithmetic and token interface:** Solidity 0.8 checked arithmetic applies. The adapter rejects fee-on-transfer mUSDC, checks the exact quote balance delta against the venue report, clears approvals, and refunds unused mWETH. SafeERC20 handles nonstandard ERC20 return values. The venue inventory bounds the conversion.
- **Failure behavior:** the swap and curve buy execute in one transaction. Tests cover slippage failure, venue failure, unknown markets, deadline expiry, pause, one-time claim, and balance preservation after revert.

The public RISE RPC fork simulation passed. The isolated beta factory and the funded ASD bridge are recorded in `deployments/11155931/`. The existing FARM market remains on the live V2 factory; the UI sells ASD on the beta curve, redeems mWETH from the finite testnet bridge reserve, and buys FARM with WETH in separate wallet transactions. This review does not claim an external audit.
