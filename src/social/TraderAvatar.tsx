import { useEffect, useState } from "react";
import type { Address } from "viem";

/** Dicebear "thumbs" avatar seeded by wallet address, falling back to initials if it fails to load. */
export function TraderAvatar({ address, name, className = "trader-avatar" }: { address: Address; name: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [address]);
  if (failed) return <span className={className} aria-hidden="true">{name.replace(/^0x/i, "").slice(0, 2).toUpperCase()}</span>;
  return <img
    className={className}
    src={`https://api.dicebear.com/10.x/thumbs/svg?seed=${address.toLowerCase()}`}
    alt=""
    onError={() => setFailed(true)}
  />;
}
