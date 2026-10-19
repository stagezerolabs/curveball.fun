import { useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { usePrivy } from "@privy-io/react-auth";
import type { Navigate } from "../types";
import { PulseFollowingCard } from "../social/PulseFollowingCard";
import { PulseNowCard } from "../social/PulseNowCard";
import { PulseTraders } from "../social/PulseTraders";
import { socialApi, socialApiConfigured } from "../social/api";
import { useFollowingBuys } from "../social/useFollowingBuys";
import { useNowPulse } from "../social/useNowPulse";
import { SocialFeed } from "../social/SocialFeed";
import { TraderDirectory } from "../social/TraderDirectory";
import type { LeaderboardSnapshot, PulsePeriod } from "../social/types";

type PulseTab = "now" | "following" | "leaderboard" | "discover";

function FeedState({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return <div className="social-feed-state" role={retry ? "alert" : "status"}>
    <strong>{title}</strong><p>{detail}</p>
    {retry ? <button type="button" onClick={retry}>Try again</button> : null}
  </div>;
}

function LoadingState() {
  return <div className="social-feed-skeleton" role="status" aria-label="Loading Pulse">
    {Array.from({ length: 3 }, (_, index) => <span className="skeleton" key={index} />)}
  </div>;
}

export function SocialPage({ navigate }: { navigate: Navigate }) {
  const { address } = useAccount();
  const { authenticated } = usePrivy();
  const [tab, setTab] = useState<PulseTab>("now");
  const [period, setPeriod] = useState<PulsePeriod>("24h");
  const [board, setBoard] = useState<LeaderboardSnapshot["category"]>("consistent");
  const now = useNowPulse(period, tab === "now");
  const following = useFollowingBuys(period, tab === "following" && authenticated);
  const ownProfile = useQuery({
    queryKey: ["social", "profile", address?.toLowerCase(), address?.toLowerCase()],
    queryFn: () => socialApi.profile(address!),
    enabled: socialApiConfigured && tab === "following" && authenticated && Boolean(address),
  });
  const leaders = useQuery({
    queryKey: ["social", "leaderboard", board, address?.toLowerCase()],
    queryFn: () => socialApi.leaderboard(board),
    enabled: socialApiConfigured && tab === "leaderboard",
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  return <main className="social-page wrap">
    <header className="social-page-heading">
      <div>
        <h1>Pulse</h1>
      </div>
    </header>

    <Tabs.Root className="pulse-tabs" value={tab} onValueChange={(value) => setTab(value as PulseTab)}>
      <div className="pulse-toolbar">
        <Tabs.List className="pulse-tab-list" aria-label="Pulse views">
          <Tabs.Tab value="now" className={tab === "now" ? "active" : ""}>Now</Tabs.Tab>
          <Tabs.Tab value="following" className={tab === "following" ? "active" : ""}>Following</Tabs.Tab>
          <Tabs.Tab value="leaderboard" className={tab === "leaderboard" ? "active" : ""}>Leaderboard</Tabs.Tab>
          <Tabs.Tab value="discover" className={tab === "discover" ? "active" : ""}>Discover</Tabs.Tab>
        </Tabs.List>
        <div className="pulse-toolbar-controls">
          {(tab === "now" || tab === "following") ? <label className="pulse-period-select">Window <select value={period} onChange={(event) => setPeriod(event.target.value as PulsePeriod)}><option value="1h">1h</option><option value="24h">24h</option></select></label> : null}
          {tab === "leaderboard" ? <label className="pulse-period-select">Ranking <select value={board} onChange={(event) => setBoard(event.target.value as LeaderboardSnapshot["category"])}><option value="consistent">Track record</option><option value="new">Emerging</option><option value="trending">Active</option><option value="followers">Followed</option></select></label> : null}
          {tab === "leaderboard" ? <button type="button" className="market-refresh" onClick={() => void leaders.refetch()} disabled={!socialApiConfigured || leaders.isFetching} aria-label={leaders.isFetching ? "Refreshing leaderboard" : "Refresh leaderboard"} aria-busy={leaders.isFetching} title="Refresh leaderboard">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M16.8 8A7 7 0 1 0 17 11" /><path d="M17 3.5V8h-4.5" /></svg>
          </button> : null}
        </div>
      </div>

      <Tabs.Panel value="now" className="pulse-panel">
        <section className="pulse-content" aria-label="Markets being bought into" aria-busy={now.isPending}>
          {now.isPending ? <LoadingState />
            : now.isError ? <FeedState title="Pulse is unavailable." detail={now.error.message} retry={() => void now.refetch()} />
            : !now.data.length ? <FeedState
              title="No markets are being bought into right now."
              detail="Markets show up here when buy value beats sell value."
            />
            : <div className="pulse-moment-list pulse-now-list">{now.data.map(({ moment, token }) => <PulseNowCard key={moment.tokenAddress} moment={moment} token={token} navigate={navigate} />)}</div>}
        </section>
        <section className="social-activity-section" aria-label="Recent confirmed trades"><h2>Recent trades</h2><SocialFeed scope="global" navigate={navigate} /></section>
      </Tabs.Panel>

      <Tabs.Panel value="following" className="pulse-panel">
        <section className="pulse-content" aria-label="Markets your follows are buying">
          {!socialApiConfigured ? <FeedState title="Following is unavailable." detail="Connect the social service to view followed traders." />
            : !authenticated || !address ? <FeedState title="Sign in to see Following." detail="Connect a linked wallet to see only the traders you follow." />
            : following.isPending || ownProfile.isPending ? <LoadingState />
            : following.isError ? <FeedState title="Following is unavailable." detail={following.error.message} retry={() => void following.refetch()} />
            : ownProfile.isError ? <FeedState title="Following is unavailable." detail={ownProfile.error.message} retry={() => void ownProfile.refetch()} />
            : !following.data.length ? ownProfile.data?.following === 0
              ? <FeedState title="You are not following anyone yet." detail="Find a trader in Discover, then follow them to see their markets here." />
              : <FeedState title="No follows buying yet." detail="Traders you follow have no qualifying buys in this window." />
            : <div className="pulse-moment-list">{following.data.map(({ buy, token }) => <PulseFollowingCard key={buy.tokenAddress} buy={buy} token={token} navigate={navigate} />)}</div>}
        </section>
        {authenticated && address ? <section className="social-activity-section" aria-label="Followed traders activity"><h2>Trades from your follows</h2><SocialFeed scope="following" navigate={navigate} /></section> : null}
      </Tabs.Panel>
      <Tabs.Panel value="discover" className="pulse-panel"><TraderDirectory navigate={navigate} /></Tabs.Panel>

      <Tabs.Panel value="leaderboard" className="pulse-panel">
        <section className="pulse-content" aria-label="Trader leaderboard" aria-busy={socialApiConfigured && leaders.isPending}>
          {!socialApiConfigured ? <FeedState title="Leaderboard is not connected." detail="Configure VITE_SOCIAL_API_URL to load trader rankings." />
            : leaders.isPending ? <LoadingState />
            : leaders.isError ? <FeedState title="Rankings are unavailable." detail={leaders.error.message} retry={() => void leaders.refetch()} />
            : <PulseTraders category={board} data={leaders.data} navigate={navigate} />}
        </section>
      </Tabs.Panel>
    </Tabs.Root>
  </main>;
}
