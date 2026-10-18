import type { ConnectedWallet } from "@privy-io/react-auth";

export function WalletIdentityMark({ wallet, className = "wallet-identity-mark" }: {
  wallet?: ConnectedWallet;
  className?: string;
}) {
  const icon = wallet?.meta.icon;
  const image = typeof icon === "string" && /^(https?:|data:image\/)/.test(icon) ? icon : null;
  if (image) return <img className={className} src={image} alt="" />;
  return <span className={className} aria-hidden="true">
    {wallet?.meta.name?.slice(0, 1).toUpperCase() ?? "C"}
  </span>;
}
