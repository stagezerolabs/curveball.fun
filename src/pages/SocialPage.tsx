import { useState, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Navigate } from "../types";
import { AppLink } from "../components/Navigation";
import { PulseFollowingCard } from "../social/PulseFollowingCard";
import { PulseNowCard } from "../social/PulseNowCard";
import { PulseTraders } from "../social/PulseTraders";
import { socialApi, socialApiConfigured } from "../social/api";
import { useFollowingActivity } from "../social/useFollowingActivity";
import { useNowPulse } from "../social/useNowPulse";

type PulseTab = "now" | "following" | "leaderboard";

function FeedState({ title, detail, retry, action }: { title: string; detail: string; retry?: () => void; action?: ReactNode }) {
  return <div className="social-feed-state" role={retry ? "alert" : "status"}>
    <strong>{title}</strong><p>{detail}</p>
    {action}
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
  const { ready: privyReady, authenticated, login } = usePrivy();
  const [tab, setTab] = useState<PulseTab>("now");
  const board = "consistent";
  const now = useNowPulse("24h", tab === "now");
  const following = useFollowingActivity(tab === "following");
  const leaders = useQuery({
    queryKey: ["social", "leaderboard", board, address?.toLowerCase()],
    queryFn: () => socialApi.leaderboard(board),
    enabled: socialApiConfigured && tab === "leaderboard",
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return <main className="social-page wrap">
    <header className="social-page-heading">
      <div>
        <h1>Pulse</h1>
        <p className="social-page-description">Follow market flow, your traders, and the leaderboard.</p>
      </div>
    </header>

    <Tabs.Root className="pulse-tabs" value={tab} onValueChange={(value) => setTab(value as PulseTab)}>
      <div className="pulse-toolbar">
        <Tabs.List className="pulse-tab-list" aria-label="Pulse views" data-selected={tab}>
          <Tabs.Tab value="now" className={tab === "now" ? "active" : ""}>Now</Tabs.Tab>
          <Tabs.Tab value="following" className={tab === "following" ? "active" : ""}>Following</Tabs.Tab>
          <Tabs.Tab value="leaderboard" className={tab === "leaderboard" ? "active" : ""}>Leaderboard</Tabs.Tab>
        </Tabs.List>
        <div className="pulse-toolbar-controls">
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
      </Tabs.Panel>

      <Tabs.Panel value="following" className="pulse-panel">
        <section className="pulse-content" aria-label="Markets your follows are active in">
          {!socialApiConfigured ? <FeedState
            title="Follows need the social service."
            detail="Without it Curveball can only read the chain, so this list is every wallet's recent buys rather than your follows."
          />
            : !address ? <FeedState
              title="Sign in to see your follows."
              detail="Pulse Following lists the markets wallets you follow created, bought, or sold."
              action={<button type="button" className="primary-button" disabled={!privyReady} onClick={login}>Create account or sign in</button>}
            />
            : following.isPending ? <LoadingState />
            : following.isError ? <FeedState title="Following is unavailable." detail={following.error.message} retry={() => void following.refetch()} />
            : !following.data?.followedCount ? <FeedState
              title="You are not following anyone yet."
              detail="Follow a trader from their profile, and their launches, buys, and sells land here."
              action={<AppLink className="primary-button" route="markets" navigate={navigate}>Find traders to follow</AppLink>}
            />
            : !following.data.items.length ? <FeedState
              title="Your follows have not traded yet."
              detail={`You follow ${following.data.followedCount} ${following.data.followedCount === 1 ? "wallet" : "wallets"}. Their launches, buys, and sells show here.`}
            />
            : <div className="pulse-moment-list">{following.data.items.map(({ activity, token }) => <PulseFollowingCard key={activity.tokenAddress} activity={activity} token={token} scope={following.data!.scope} navigate={navigate} />)}</div>}
        </section>
      </Tabs.Panel>

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
