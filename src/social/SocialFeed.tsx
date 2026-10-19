import { useInfiniteQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Address } from "viem";
import type { Navigate } from "../types";
import { socialApi, socialApiConfigured } from "./api";
import { SocialTradeCard } from "./SocialTradeCard";

export function SocialFeed({ scope, navigate, trader }: { scope: "global" | "following"; navigate: Navigate; trader?: Address }) {
  const { address } = useAccount();
  const feed = useInfiniteQuery({
    queryKey: ["social", "feed", scope, trader?.toLowerCase(), address?.toLowerCase()],
    queryFn: ({ pageParam }) => socialApi.feed(scope, pageParam || undefined, trader),
    initialPageParam: "",
    getNextPageParam: (page) => page.nextCursor || undefined,
    enabled: socialApiConfigured && (scope === "global" || Boolean(address)),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
  if (!socialApiConfigured) return <p className="social-feed-state">Social activity is unavailable.</p>;
  if (scope === "following" && !address) return <p className="social-feed-state">Connect a linked wallet to see followed traders’ activity.</p>;
  if (feed.isPending) return <div className="social-feed-skeleton" aria-busy="true" aria-label="Loading activity"><span className="skeleton" /><span className="skeleton" /></div>;
  if (feed.isError) return <div className="social-feed-state" role="alert"><strong>Activity is unavailable.</strong><p>{feed.error.message}</p><button type="button" onClick={() => void feed.refetch()}>Try again</button></div>;
  const trades = feed.data.pages.flatMap((page) => page.items);
  return <div className="social-feed">
    {trades.length ? <div className="social-feed-list">{trades.map((trade) => <SocialTradeCard key={trade.id} trade={trade} navigate={navigate} />)}</div>
      : <div className="social-feed-state"><strong>No trades yet.</strong><p>{scope === "following" ? "Follow a trader to see their confirmed trades here." : "Confirmed trades will appear here."}</p></div>}
    {feed.hasNextPage ? <button className="profile-secondary-action social-load-more" type="button" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>{feed.isFetchingNextPage ? "Loading…" : "Load more trades"}</button> : null}
  </div>;
}
