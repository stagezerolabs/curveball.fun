import { formatEther, parseEther } from "viem";
import { formatEthAmount } from "../lib/format.js";
import { NATIVE_GAS_RESERVE } from "../sdk/wagmiSdk";

export type BuyFundingState = Readonly<{
  canFund: boolean;
  needsWrap: boolean;
  shortfall: bigint;
}>;

export function getBuyFundingState(
  amount: string,
  wethBalance?: bigint,
  nativeBalance?: bigint,
): BuyFundingState | null {
  if (wethBalance === undefined || nativeBalance === undefined) return null;
  let required: bigint;
  try {
    required = parseEther(amount || "0");
  } catch {
    return null;
  }
  const shortfall = required > wethBalance ? required - wethBalance : 0n;
  return Object.freeze({
    canFund: shortfall === 0n || nativeBalance >= shortfall + NATIVE_GAS_RESERVE,
    needsWrap: shortfall > 0n,
    shortfall,
  });
}

function amount(value: bigint) {
  return formatEthAmount(Number(formatEther(value)));
}

export function TradeFundingStatus({
  amount: input,
  wethBalance,
  nativeBalance,
}: {
  amount: string;
  wethBalance?: bigint;
  nativeBalance?: bigint;
}) {
  const funding = getBuyFundingState(input, wethBalance, nativeBalance);
  if (wethBalance === undefined) {
    return <p className="trade-hint">Checking WETH balance…</p>;
  }
  if (funding?.needsWrap && !funding.canFund) {
    return (
      <p className="trade-hint warn" role="alert">
        Not enough ETH to wrap the required WETH and pay network fees.
      </p>
    );
  }
  return (
    <p className="trade-hint">
      {amount(wethBalance)} WETH available
      {funding?.needsWrap
        ? ` · ${amount(funding.shortfall)} ETH will be wrapped to WETH before buying.`
        : ""}
    </p>
  );
}
