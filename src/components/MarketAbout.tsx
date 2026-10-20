import { useEffect, useState, type ReactNode } from "react";
import { formatEther } from "viem";
import { useQuery } from "@tanstack/react-query";
import { formatAddress } from "../lib/format.js";
import { tokenDescription } from "../lib/tokenMetadata";
import { activeExplorerUrl } from "../lib/web3";
import { socialApi, socialApiConfigured } from "../social/api";
import { FollowButton } from "../social/FollowButton";
import { TraderIdentity } from "../social/TraderIdentity";
import type { Navigate, Token } from "../types";

function AddressValue({ address }: { address: string }) {
  return <a className="market-about-address" href={`${activeExplorerUrl}/address/${address}`} target="_blank" rel="noreferrer" title={address}>
    <span>{formatAddress(address)}</span>
    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M11 4h5v5M16 4l-8 8M15 12v3.5A1.5 1.5 0 0 1 13.5 17h-9A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5H8" /></svg>
  </a>;
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return <div className="market-about-fact"><dt>{label}</dt><dd>{children}</dd></div>;
}

/** The launcher is a trader like any other: who they are, whether you follow them, and how many others do. */
function CreatorRow({ creator, navigate }: { creator: `0x${string}`; navigate: Navigate }) {
  const profile = useQuery({
    queryKey: ["social", "profile", creator.toLowerCase()],
    queryFn: () => socialApi.profile(creator),
    enabled: socialApiConfigured,
    staleTime: 60_000,
    retry: 1,
  });
  if (!socialApiConfigured) return <AddressValue address={creator} />;
  const data = profile.data;
  return <div className="market-creator-row">
    <TraderIdentity address={creator} navigate={navigate} compact />
    {data ? <span className="market-creator-followers">{data.followers} {data.followers === 1 ? "follower" : "followers"}</span> : null}
    <FollowButton trader={creator} following={Boolean(data?.isFollowed)} />
  </div>;
}

function formatSupply(supply?: string | null) {
  if (!supply || !/^\d+$/.test(supply)) return "—";
  return Number(formatEther(BigInt(supply))).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function MarketAbout({ token, navigate }: { token: Token; navigate: Navigate }) {
  const [metadataDescription, setMetadataDescription] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    setMetadataDescription(null);
    if (token.metadataUri) void tokenDescription(token.metadataUri).then((value) => {
      if (active) setMetadataDescription(value);
    });
    return () => { active = false; };
  }, [token.metadataUri]);
  const created = new Date(token.createdAt);
  const createdLabel = Number.isNaN(created.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(created);
  const description = token.description?.trim() || metadataDescription;

  return <section className="market-about" aria-labelledby="market-about-title">
    <h2 id="market-about-title">About {token.name}</h2>
    {description && <p>{description}</p>}
    <dl className="market-about-facts">
      {token.pool && <Fact label="Pool"><AddressValue address={token.pool} /></Fact>}
      <Fact label="Supply">{formatSupply(token.supply)} {token.symbol}</Fact>
      <Fact label="Created">{createdLabel}</Fact>
      <Fact label="Status">{token.graduated ? "Graduated" : token.pending ? "Ready to graduate" : "On the curve"}</Fact>
    </dl>
    <details className="market-about-chain" open>
      <summary>On chain</summary>
      <dl className="market-about-facts">
        <Fact label="Token contract"><AddressValue address={token.address} /></Fact>
        {token.factory && <Fact label="Launchpad"><AddressValue address={token.factory} /></Fact>}
        <Fact label="Creator"><CreatorRow creator={token.creator} navigate={navigate} /></Fact>
      </dl>
    </details>
  </section>;
}
