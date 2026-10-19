import { useQuery } from "@tanstack/react-query";
import type { Address } from "viem";
import type { Navigate } from "../types";
import { formatAddress } from "../lib/format.js";
import { fetchRnsPrimaryName } from "../lib/rnsPrimary";
import { AppLink } from "../components/Navigation";
import { TraderAvatar } from "./TraderAvatar";

export function TraderIdentity({
  address,
  displayName,
  navigate,
  compact = false,
  showAddress = true,
}: {
  address: Address;
  displayName?: string | null;
  navigate: Navigate;
  compact?: boolean;
  showAddress?: boolean;
}) {
  const { data: rnsName } = useQuery({
    queryKey: ["rns", "primary", address.toLowerCase()],
    queryFn: ({ signal }) => fetchRnsPrimaryName(address, signal),
    staleTime: 60_000,
    retry: 1,
  });
  const name = rnsName ?? displayName;

  return (
    <AppLink
      className={`trader-identity${compact ? " compact" : ""}`}
      route="trader"
      params={{ address }}
      navigate={navigate}
      title={showAddress ? address : undefined}
    >
      <TraderAvatar address={address} name={name ?? address} />
      <span>
        <strong>{name ?? formatAddress(address)}</strong>
        {name && !compact && showAddress ? <small>{formatAddress(address)}</small> : null}
      </span>
    </AppLink>
  );
}
