# M0 follow-up review

## Local-fork factory check

`contracts/test/fork/icarus-factory.ts` deploys two throwaway ERC-20s on a local Hardhat fork and calls `createPool(tokenA, tokenB, false)` from an ordinary local signer. It does not submit a RISE transaction. The supplied public RPC currently blocks this check: it returns JSON-RPC `-32601 Method not found` for Hardhat's required `net_version`, and Foundry Anvil's TLS client fails its chain-id request (`BadRecordMac`). The test is ready to run with a compatible endpoint via `RISE_RPC_URL`; no mainnet transaction was attempted.

## Canonical WETH

The candidate is `0x4200000000000000000000000000000000000006`. It was established from live Icarus factory registry reads on 2026-09-15: pools 0, 1, 3, and 4 include this address. Blockscout returns verified contract name `WETH`, source `src/L2/WETH.sol`, and an ABI with `deposit()`, `withdraw(uint256)`, and ERC-20 `decimals()`. This confirms the address from chain evidence; it was not selected merely because it resembles an OP-stack predeploy.

## Diff conclusions

The verified Icarus factory retains public `createPool(address,address,bool)`, deterministic cloning, `getPool`, and `isPool`; the verified pool retains `mint`, reserve tracking, `skim`, `sync`, and `claimFees`. The observed factory additions are `unstakedFee`, `MAX_UNSTAKED_FEE`, and `customUnstakedFee`; they do not change pool creation or the direct-transfer-plus-`mint` graduation sequence. Current live values are volatile fee 30 bps, stable fee 5 bps, max fee 300 bps.

The graduation adapter must still avoid the router. It must create/reuse the volatile pool, validate `isPool`, transfer assets directly to the pool, then call `mint(locker)`. It must not assume that fee routing is immutable; live fee values should be indexed/displayed after graduation.
