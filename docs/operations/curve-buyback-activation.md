# Activate CURVE buybacks on RISE mainnet

The oracle-v3 buyback treasury at `0x402524223D629A7bf59b94DB0798a6D4995d5B0E` can permanently select one graduated launchpad token. The intended token is CURVE at `0x65014eDD6ea4A53152780742360Fb4685Abab689`. The treasury is owned by the two-day timelock at `0xC7FD90b14110D4b4a1854c9b1A14aC934f1d2f5d`. The `dot` keystore is its proposer and executor.

As of 25 November 2026, this CURVE market is still `Trading`: its `poolOf` is zero and the treasury's `curveToken` is zero. `setCurveToken` rejects the token until the 800 million curve-sale tokens sell out and the market graduates. The timelock operation is already scheduled and unlocks at **27 November 2026, 18:17:25 UTC**. Execution must wait for both the timelock and graduation.

The schedule transaction is `0x9400ea2283d2e759c6af4b86c618d398bbce66e6ce576bef5347de5ced7ace0f`; the operation ID is `0x585fc762cc13b324e0cca54bba94b5414632467bf66c5b131359e710af51a669`. See [`deployments/4153/curve-activation-schedule.json`](../../deployments/4153/curve-activation-schedule.json) for the exact call data, salt, and timestamp. Do not submit another schedule transaction while this operation exists.

## Verify the scheduled operation

Run in the repository root. These reads reconstruct the operation ID and check its live timelock timestamp.

```sh
RPC_URL=${RISE_MAINNET_RPC_URL:-https://rpc.risechain.com}
LAUNCHPAD=0xC2C337301303d8bE4803042425aA5A325d30e6d7
TREASURY=0x402524223D629A7bf59b94DB0798a6D4995d5B0E
TIMELOCK=0xC7FD90b14110D4b4a1854c9b1A14aC934f1d2f5d
TOKEN=0x65014eDD6ea4A53152780742360Fb4685Abab689
ZERO=0x0000000000000000000000000000000000000000000000000000000000000000
SALT=$(cast keccak 'curveball:4153:oracle-v3:CURVE')
DATA=$(cast calldata 'setCurveToken(address)' "$TOKEN")

cast chain-id --rpc-url "$RPC_URL"
cast call "$TREASURY" 'owner()(address)' --rpc-url "$RPC_URL"
cast call "$TREASURY" 'curveToken()(address)' --rpc-url "$RPC_URL"
cast call "$LAUNCHPAD" 'poolOf(address)(address)' "$TOKEN" --rpc-url "$RPC_URL"
cast call "$TIMELOCK" 'getMinDelay()(uint256)' --rpc-url "$RPC_URL"
OPERATION_HASH=$(cast call "$TIMELOCK" 'hashOperation(address,uint256,bytes,bytes32,bytes32)(bytes32)' "$TREASURY" 0 "$DATA" "$ZERO" "$SALT" --rpc-url "$RPC_URL")
cast call "$TIMELOCK" 'getTimestamp(bytes32)(uint256)' "$OPERATION_HASH" --rpc-url "$RPC_URL"
```

The operation ID must equal the recorded value, and `getTimestamp` must return `1795803445`. If it returns zero, the operation was canceled or removed and needs a new operator review.

## Execute after graduation

Read `poolOf(TOKEN)` again. It must be nonzero, `seedObservations(TOKEN)` must be nonzero, and `curveToken()` must still be zero. Also check that the timelock operation is ready. Then execute with the same `DATA`, `ZERO`, and `SALT` values as above:

```sh
cast call "$TREASURY" 'seedObservations(address)(uint256)' "$TOKEN" --rpc-url "$RPC_URL"
cast call "$TIMELOCK" 'isOperationReady(bytes32)(bool)' "$OPERATION_HASH" --rpc-url "$RPC_URL"
cast send "$TIMELOCK" 'execute(address,uint256,bytes,bytes32,bytes32)' "$TREASURY" 0 "$DATA" "$ZERO" "$SALT" --rpc-url "$RPC_URL" --account dot

cast call "$TREASURY" 'curveToken()(address)' --rpc-url "$RPC_URL"
CURVE_CHAIN_ID=4153 CURVE_RPC_URL="$RPC_URL" CURVE_TOKEN_ADDRESS="$TOKEN" bun contracts/scripts/record-curve-activation.ts
```

If starting a fresh shell, restore `RPC_URL`, `LAUNCHPAD`, `TREASURY`, `TIMELOCK`, `TOKEN`, `ZERO`, `SALT`, `DATA`, and `OPERATION_HASH` to the values used for scheduling. Verify the execute receipt emitted `CurveTokenSet(TOKEN)`, then commit `deployments/4153/curve-activation.json` with both transaction hashes in the commit message or release notes. The recorder reads the live treasury and refuses a different token or launchpad.

After selection, the keeper can use the pooled WETH budget for guarded CURVE purchases and burns. Selection alone does not trade or burn. The keeper does not collect locked LP fees or escrow claims; assign those operations separately and monitor `quoteBudget`, `tokenBudget`, `BuybackBurned`, and `SwapSkipped`.
