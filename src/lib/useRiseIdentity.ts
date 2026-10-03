import { useEffect, useState } from "react";
import { rnsClient } from "./rns";

export function useRiseIdentity(address?: string): string | null {
  const [resolved, setResolved] = useState<{ address: string; name: string | null } | null>(null);

  useEffect(() => {
    if (!address) return;
    let active = true;
    void rnsClient.getReverse(address).then(
      (identity) => {
        if (active) setResolved({ address, name: identity.displayName });
      },
      () => {
        if (active) setResolved({ address, name: null });
      },
    );
    return () => { active = false; };
  }, [address]);

  return resolved && resolved.address === address ? resolved.name : null;
}
