import { useState, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Navigate } from "../types";
import { PulseNowCard } from "../social/PulseNowCard";
import { PulseTraders } from "../social/PulseTraders";
import { socialApi, socialApiConfigured } from "../social/api";
import { useNowPulse } from "../social/useNowPulse";

export const PULSE_TABS = [
  { value: "now", label: "Now" },
  { value: "leaderboard", label: "Leaderboard" },
] as const;

type PulseTab = (typeof PULSE_TABS)[number]["value"];

function FeedState({
  title,
  detail,
  retry,
  action,
}: {
  title: string;
  detail: string;
  retry?: () => void;
  action?: ReactNode;
}) {
  return (
    <div className="social-feed-state" role={retry ? "alert" : "status"}>
      <strong>{title}</strong>
      <p>{detail}</p>
      {action}
      {retry ? (
        <button type="button" onClick={retry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

function LoadingState() {
  return (
    <div
      className="social-feed-skeleton"
      role="status"
      aria-label="Loading Pulse"
    >
      {Array.from({ length: 3 }, (_, index) => (
        <span className="skeleton" key={index} />
      ))}
    </div>
  );
}

export function SocialPage({ navigate }: { navigate: Navigate }) {
  const { address } = useAccount();
  const [tab, setTab] = useState<PulseTab>("now");
  const board = "consistent";
  const now = useNowPulse("24h", tab === "now");
  const leaders = useQuery({
    queryKey: ["social", "leaderboard", board, address?.toLowerCase()],
    queryFn: () => socialApi.leaderboard(board),
    enabled: socialApiConfigured && tab === "leaderboard",
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return (
    <main className="social-page wrap">
      <header className="social-page-heading">
        <div>
          <h1>Pulse</h1>
          <p className="social-page-description">
            Follow market flow and the leaderboard.
          </p>
        </div>
      </header>

      <Tabs.Root
        className="pulse-tabs"
        value={tab}
        onValueChange={(value) => setTab(value as PulseTab)}
      >
        <div className="pulse-toolbar">
          <Tabs.List
            className="pulse-tab-list"
            aria-label="Pulse views"
            data-selected={tab}
          >
            {PULSE_TABS.map(({ value, label }) => (
              <Tabs.Tab
                key={value}
                value={value}
                className={tab === value ? "active" : ""}
              >
                {label}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <div className="pulse-toolbar-controls">
            {tab === "leaderboard" ? (
              <button
                type="button"
                className="market-refresh"
                onClick={() => void leaders.refetch()}
                disabled={!socialApiConfigured || leaders.isFetching}
                aria-label={
                  leaders.isFetching
                    ? "Refreshing leaderboard"
                    : "Refresh leaderboard"
                }
                aria-busy={leaders.isFetching}
                title="Refresh leaderboard"
              >
                <svg
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M16.8 8A7 7 0 1 0 17 11" />
                  <path d="M17 3.5V8h-4.5" />
                </svg>
              </button>
            ) : null}
          </div>
        </div>

        <Tabs.Panel value="now" className="pulse-panel">
          <section
            className="pulse-content"
            aria-label="Markets being bought into"
            aria-busy={now.isPending}
          >
            {now.isPending ? (
              <LoadingState />
            ) : now.isError ? (
              <FeedState
                title="Pulse is unavailable."
                detail={now.error.message}
                retry={() => void now.refetch()}
              />
            ) : !now.data.length ? (
              <FeedState
                title="No markets are being bought into right now."
                detail="Markets show up here when buy value beats sell value."
              />
            ) : (
              <div className="pulse-moment-list pulse-now-list">
                {now.data.map(({ moment, token }) => (
                  <PulseNowCard
                    key={moment.tokenAddress}
                    moment={moment}
                    token={token}
                    navigate={navigate}
                  />
                ))}
              </div>
            )}
          </section>
        </Tabs.Panel>

        <Tabs.Panel value="leaderboard" className="pulse-panel">
          <section
            className="pulse-content"
            aria-label="Trader leaderboard"
            aria-busy={socialApiConfigured && leaders.isPending}
          >
            {!socialApiConfigured ? (
              <FeedState
                title="Leaderboard is not connected."
                detail="Configure VITE_SOCIAL_API_URL to load trader rankings."
              />
            ) : leaders.isPending ? (
              <LoadingState />
            ) : leaders.isError ? (
              <FeedState
                title="Rankings are unavailable."
                detail={leaders.error.message}
                retry={() => void leaders.refetch()}
              />
            ) : (
              <PulseTraders
                category={board}
                data={leaders.data}
                navigate={navigate}
              />
            )}
          </section>
        </Tabs.Panel>
      </Tabs.Root>
    </main>
  );
}
