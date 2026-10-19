import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import type { Navigate } from "../types";
import { TraderIdentity } from "./TraderIdentity";
import { FollowButton } from "./FollowButton";
import { socialApi, socialApiConfigured } from "./api";
import type { TraderSummary } from "./types";

export function TraderDirectory({ navigate, address, kind }: { navigate: Navigate; address?: Address; kind?: "followers" | "following" }) {
  const [search, setSearch] = useState("");
  const { address: wallet } = useAccount();
  const directory = useInfiniteQuery({
    queryKey: ["social", "traders", address?.toLowerCase(), kind, search.trim(), wallet?.toLowerCase()],
    queryFn: ({ pageParam }) => address && kind
      ? socialApi.profileConnections(address, kind, pageParam || undefined)
      : socialApi.discoverTraders(search.trim(), pageParam || undefined),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: socialApiConfigured,
    staleTime: 30_000,
  });
  const items = directory.data?.pages.flatMap((page) => page.items) ?? [];
  return <section className="trader-directory" aria-label={kind ? `Trader ${kind}` : "Discover traders"}>
    {!kind ? <label className="market-search"><span className="visually-hidden">Search traders</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search traders by name or wallet" /></label> : null}
    {directory.isPending ? <p role="status">Loading traders…</p>
      : directory.isError ? <div className="social-feed-state" role="alert"><strong>Traders are unavailable.</strong><p>{directory.error.message}</p><button type="button" onClick={() => void directory.refetch()}>Try again</button></div>
        : items.length ? <ul className="trader-directory-list">{items.map((trader: TraderSummary) => <li key={trader.address}><div><TraderIdentity address={trader.address} displayName={trader.displayName} navigate={navigate} /><small>{trader.followers} followers</small>{trader.bio ? <p>{trader.bio}</p> : null}</div><FollowButton trader={trader.address} following={trader.isFollowed} /></li>)}</ul>
          : <p className="social-feed-state">{kind ? `No ${kind} yet.` : search ? "No traders match your search." : "No discoverable traders yet."}</p>}
    {directory.hasNextPage ? <button className="profile-secondary-action social-load-more" type="button" disabled={directory.isFetchingNextPage} onClick={() => void directory.fetchNextPage()}>{directory.isFetchingNextPage ? "Loading…" : "Load more traders"}</button> : null}
  </section>;
}
