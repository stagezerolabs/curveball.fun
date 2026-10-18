import { useCallback, useEffect, useRef } from "react";
import { useLogin, usePrivy } from "@privy-io/react-auth";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import { socialApi } from "./api";
import { createSocialAuthRequestGate, selectSocialAuthAction } from "./socialAuthPolicy";

export function useSocialAuth() {
  const { address } = useAccount();
  const { ready, authenticated } = usePrivy();
  const queryClient = useQueryClient();
  const authRequestGate = useRef<ReturnType<typeof createSocialAuthRequestGate<Address>>>();
  if (!authRequestGate.current) authRequestGate.current = createSocialAuthRequestGate<Address>();
  const { login } = useLogin({
    onError: () => {
      authRequestGate.current?.reject(new Error("Sign in was not completed."));
    },
  });

  const confirmBackendIdentity = useCallback(async (wallet: Address): Promise<Address> => {
    const current = await socialApi.me();
    if (current.address?.toLowerCase() !== wallet.toLowerCase()) {
      throw new Error("Curveball could not confirm the active wallet on your Privy account.");
    }
    await queryClient.invalidateQueries({ queryKey: ["social"] });
    return wallet;
  }, [queryClient]);

  useEffect(() => {
    if (!authRequestGate.current?.hasPendingRequest() || !ready || !authenticated || !address) return;
    void confirmBackendIdentity(address).then(authRequestGate.current.resolve, authRequestGate.current.reject);
  }, [address, authenticated, confirmBackendIdentity, ready]);

  useEffect(() => () => {
    authRequestGate.current?.reject(new Error("Sign in was interrupted."));
  }, []);

  const ensureAuthenticated = useCallback(async (): Promise<Address> => {
    const action = selectSocialAuthAction({ ready, authenticated, hasAddress: Boolean(address) });
    if (action === "confirm" && address) return confirmBackendIdentity(address);
    if (action === "loading") throw new Error("Privy is still loading. Try again in a moment.");
    return authRequestGate.current!.request(action === "login" ? login : undefined);
  }, [address, authenticated, confirmBackendIdentity, login, ready]);

  return { address, authenticated, ready, ensureAuthenticated };
}
