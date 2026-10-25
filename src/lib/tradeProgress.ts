import type { TradePhase, TradeSide } from "../sdk/sdk";

export function tradeButtonLabel(
  side: TradeSide,
  phase: TradePhase | null,
): string {
  if (!phase) return side === "buy" ? "Buy" : "Sell";
  const action = side === "buy" ? "buy" : "sell";
  switch (phase) {
    case "preparing":
      return `Checking ${action} details…`;
    case "wrapWallet":
      return "Confirm ETH funding in wallet";
    case "wrapConfirming":
      return "Funding buy with ETH…";
    case "approveWallet":
      return side === "buy"
        ? "Approve payment in wallet"
        : "Approve token sale in wallet";
    case "approveConfirming":
      return side === "buy" ? "Approving payment…" : "Approving token sale…";
    case "tradeWallet":
      return `Confirm ${action} in wallet`;
    case "tradeConfirming":
      return side === "buy"
        ? "Buy submitted · waiting for RISE"
        : "Sell submitted · waiting for RISE";
  }
}
