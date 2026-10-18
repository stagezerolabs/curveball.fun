export type WalletFundingMode = "privy-modal" | "receive-address";

export function isPrivyManagedWallet(walletClientType?: string) {
  return walletClientType === "privy" || walletClientType === "privy-v2";
}

export function selectWalletFundingMode({
  hasWallet,
  walletClientType,
  isTestnet,
}: {
  hasWallet: boolean;
  walletClientType?: string;
  isTestnet: boolean;
}): WalletFundingMode | null {
  if (!hasWallet) return null;
  return isTestnet || !isPrivyManagedWallet(walletClientType)
    ? "receive-address"
    : "privy-modal";
}
