import { useEffect, useRef } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { socialApi, socialApiConfigured } from "./api";
import { selectSocialAuthAction } from "./socialAuthPolicy";

/** Claims the signed-in wallet's profile as soon as Privy has verified ownership of it. */
export function ProfileClaimSync() {
  const { ready, authenticated } = usePrivy();
  const { address } = useAccount();
  const queryClient = useQueryClient();
  const claimedAddress = useRef<string | null>(null);

  useEffect(() => {
    if (!authenticated) claimedAddress.current = null;
    if (!socialApiConfigured || !address) return;
    if (
      selectSocialAuthAction({ ready, authenticated, hasAddress: true }) !==
      "confirm"
    )
      return;
    const key = address.toLowerCase();
    if (claimedAddress.current === key) return;
    claimedAddress.current = key;
    socialApi
      .me()
      .then(() => queryClient.invalidateQueries({ queryKey: ["social"] }))
      .catch(() => {
        claimedAddress.current = null;
      });
  }, [address, authenticated, queryClient, ready]);

  return null;
}
