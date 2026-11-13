import { formatEther } from "viem";
import { formatEthAmount } from "../lib/format.js";
import { UsdAmount } from "./UsdAmount";

export function combinedBalance(
  nativeBalance?: bigint,
  wethBalance?: bigint,
) {
  return nativeBalance === undefined || wethBalance === undefined
    ? undefined
    : nativeBalance + wethBalance;
}

function balanceLabel(balance: bigint | undefined, symbol: string, loading: boolean) {
  return balance !== undefined
    ? `${formatEthAmount(Number(formatEther(balance)))} ${symbol}`
    : loading
      ? `… ${symbol}`
      : `— ${symbol}`;
}

export function AccountBalances({
  nativeBalance,
  nativeSymbol = "ETH",
  wethBalance,
  nativeLoading = false,
  wethLoading = false,
}: {
  nativeBalance?: bigint;
  nativeSymbol?: string;
  wethBalance?: bigint;
  nativeLoading?: boolean;
  wethLoading?: boolean;
}) {
  const totalBalance = combinedBalance(nativeBalance, wethBalance);

  return (
    <div className="account-balance">
      <small>Balance</small>
      <strong aria-live="polite">
        {totalBalance !== undefined ? (
          <UsdAmount weth={Number(formatEther(totalBalance))} />
        ) : nativeLoading || wethLoading ? (
          "…"
        ) : (
          "—"
        )}
      </strong>
      <small className="account-balance-native">
        {balanceLabel(nativeBalance, nativeSymbol, nativeLoading)}
        {" · "}
        {balanceLabel(wethBalance, "WETH", wethLoading)}
      </small>
    </div>
  );
}
