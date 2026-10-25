import type { Address } from "viem";
import { formatAddress } from "../lib/format.js";
import { AppLink } from "../components/Navigation";
import type { Navigate } from "../types";
import { TraderAvatar } from "./TraderAvatar";
import { useTraderName } from "./useTraderName";

/** Inline trader name that links to the profile, for places where a full identity row does not fit. */
export function TraderName({
  address,
  navigate,
}: {
  address: Address;
  navigate: Navigate;
}) {
  const { label } = useTraderName(address);
  return (
    <AppLink
      className="trader-name"
      route="trader"
      params={{ address }}
      navigate={navigate}
      title={address}
    >
      {label}
    </AppLink>
  );
}

export function TraderIdentity({
  address,
  navigate,
  compact = false,
  showAddress = true,
}: {
  address: Address;
  navigate: Navigate;
  compact?: boolean;
  showAddress?: boolean;
}) {
  const { name, label } = useTraderName(address);

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
        <strong>{label}</strong>
        {name && !compact && showAddress ? (
          <small>{formatAddress(address)}</small>
        ) : null}
      </span>
    </AppLink>
  );
}
