import { useState } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Navigate } from "../types";
import { exampleFollowingTraders, mockPulseMoments } from "../social/mockPulse";
import { PulseMomentCard } from "../social/PulseMomentCard";
import { PulseTraders } from "../social/PulseTraders";
import { socialApi, socialApiConfigured } from "../social/api";
import type { PulsePeriod } from "../social/types";

type PulseTab = "now" | "following" | "leaderboard";

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
  const [tab, setTab] = useState<PulseTab>("now");
  const [period, setPeriod] = useState<PulsePeriod>("24h");
  const [board, setBoard] = useState<"consistent" | "new">("consistent");
  const [mockAsOf] = useState(Date.now);
  const nowMoments = mockPulseMoments("now", period, mockAsOf);
  const followingMoments = mockPulseMoments("following", period, mockAsOf);
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
        </Tabs.List>
        <div className="pulse-toolbar-controls">
          {tab === "now" || tab === "following" ? <div className="social-segmented" role="group" aria-label="Activity window">
            <button type="button" aria-pressed={period === "1h"} onClick={() => setPeriod("1h")}>1h</button>
            <button type="button" aria-pressed={period === "24h"} onClick={() => setPeriod("24h")}>24h</button>
          </div> : <>
            <div className="social-segmented" role="group" aria-label="Trader ranking">
              <button type="button" aria-pressed={board === "consistent"} onClick={() => setBoard("consistent")}>Track record</button>
              <button type="button" aria-pressed={board === "new"} onClick={() => setBoard("new")}>Emerging</button>
            </div>
            <button className="pulse-refresh" type="button" onClick={() => void leaders.refetch()} disabled={!socialApiConfigured || leaders.isFetching} aria-label={leaders.isFetching ? "Updating leaderboard" : "Refresh leaderboard"}>
              <span aria-hidden="true">↻</span> {leaders.isFetching ? "Updating" : "Refresh"}
            </button>
          </>}
        </div>
      </div>

      <Tabs.Panel value="now" className="pulse-panel">
        <section className="pulse-content" aria-label="Example market moments">
          <div className="pulse-moment-list">{nowMoments.map((moment) => <PulseMomentCard key={moment.tokenAddress} moment={moment} navigate={navigate} newSinceVisit={false} preview />)}</div>
        </section>
        <p className="pulse-context">The live version will group confirmed curve trades by market. Wallet count will not prove independent traders.</p>
      </Tabs.Panel>

      <Tabs.Panel value="following" className="pulse-panel">
        <section className="pulse-content" aria-label="Example followed trader moments">
          <div className="pulse-example-following">
            <div><h2>Example follows</h2><p>A sample of how your followed traders will appear here.</p></div>
            <ul>{exampleFollowingTraders.map((trader) => <li key={trader.name}><span className="trader-avatar" aria-hidden="true">{trader.name.slice(0, 2).toUpperCase()}</span><span><strong>{trader.name}</strong><small>{trader.focus}</small></span></li>)}</ul>
          </div>
          <div className="pulse-moment-list">{followingMoments.map((moment) => <PulseMomentCard key={moment.tokenAddress} moment={moment} navigate={navigate} newSinceVisit={false} preview />)}</div>
        </section>
        <p className="pulse-context">The connected version will use your followed wallets and exclude blocked wallets before grouping activity.</p>
      </Tabs.Panel>

      <Tabs.Panel value="leaderboard" className="pulse-panel">
        <section className="pulse-content" aria-label="Trader leaderboard" aria-busy={socialApiConfigured && leaders.isPending}>
          {!socialApiConfigured ? <FeedState title="Leaderboard is not connected." detail="Configure VITE_SOCIAL_API_URL to load published trader rankings." />
            : leaders.isPending ? <LoadingState />
            : leaders.isError ? <FeedState title="Rankings are unavailable." detail={leaders.error.message} retry={() => void leaders.refetch()} />
              : leaders.data ? <PulseTraders category={board} data={leaders.data} navigate={navigate} /> : null}
        </section>
      </Tabs.Panel>
    </Tabs.Root>
  </main>;
}
