import { formatEther } from "viem";
import { formatEthAmount } from "../lib/format.js";
import { UsdAmount } from "./UsdAmount";

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
  const balances = [
    { symbol: nativeSymbol, balance: nativeBalance, loading: nativeLoading },
    { symbol: "WETH", balance: wethBalance, loading: wethLoading },
  ];

  return (
    <div className="account-balance">
      {balances.map(({ symbol, balance, loading }) => (
        <div className="account-asset-balance" key={symbol}>
          <small>{symbol} balance</small>
          <strong aria-live="polite">
            {balance !== undefined ? (
              <UsdAmount weth={Number(formatEther(balance))} />
            ) : loading ? (
              "…"
            ) : (
              "—"
            )}
          </strong>
          <small className="account-balance-native">
            {balance !== undefined
              ? `${formatEthAmount(Number(formatEther(balance)))} ${symbol}`
              : loading
                ? "…"
                : `— ${symbol}`}
          </small>
        </div>
      ))}
      <small className="account-balance-hint">
        Max buys use WETH first, then ETH, with some ETH left for gas.
      </small>
    </div>
  );
}
