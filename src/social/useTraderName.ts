import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import { formatAddress } from "../lib/format.js";
import { fetchRnsPrimaryName } from "../lib/rnsPrimary";

/** Trader identity is RNS-only: a .rise primary name, otherwise the wallet address. */
export function useTraderName(address?: Address | null) {
  const { data } = useQuery({
    queryKey: ["rns", "primary", address?.toLowerCase()],
    queryFn: ({ signal }) => fetchRnsPrimaryName(address!, signal),
    enabled: Boolean(address),
    staleTime: 60_000,
    retry: 1,
  });
  const name = data ?? null;
  return {
    name,
    label: address ? (name ?? formatAddress(address)) : "",
  };
}
