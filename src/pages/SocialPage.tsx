import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import type { Navigate } from "../types";
import { SocialTradeCard } from "../social/SocialTradeCard";
import { socialApi, socialApiBaseUrl, socialApiConfigured } from "../social/api";
import { useSocialAuth } from "../social/useSocialAuth";

type FeedScope = "global" | "following";

export function SocialPage({ navigate }: { navigate: Navigate }) {
  const { address } = useAccount();
  const { ensureAuthenticated } = useSocialAuth();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<FeedScope>("global");
  const [notice, setNotice] = useState("");

  const feed = useQuery({
    queryKey: ["social", "feed", scope, address?.toLowerCase()],
    queryFn: () => socialApi.feed(scope),
    enabled: socialApiConfigured && (scope === "global" || Boolean(address)),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (!socialApiConfigured) return undefined;
    const source = new EventSource(`${socialApiBaseUrl}/v1/events`, { withCredentials: true });
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["social", "feed"] });
    source.addEventListener("trade", refresh);
    return () => source.close();
  }, [queryClient]);

  async function selectScope(next: FeedScope) {
    setNotice("");
    if (next === "following") {
      try {
        await ensureAuthenticated();
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "Sign in to view followed traders.");
        return;
      }
    }
    setScope(next);
  }

  return (
    <main className="social-page wrap">
      <header className="social-page-heading">
        <div>
          <h1>Pulse</h1>
        </div>
        <div className="social-segmented" role="group" aria-label="Activity feed filter">
          <button type="button" aria-pressed={scope === "global"} onClick={() => void selectScope("global")}>Feed</button>
          <button type="button" aria-pressed={scope === "following"} onClick={() => void selectScope("following")}>Following</button>
        </div>
      </header>

      {!socialApiConfigured ? <section className="social-service-state" role="status">
        <h2>Social service is not connected</h2>
        <p>Set <code>VITE_SOCIAL_API_URL</code> to the VPS service origin to load verified activity, profiles, and follows.</p>
      </section> : null}
      {notice ? <p className="notice notice-dismissible" role="alert"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss message">×</button></p> : null}

      <div className="social-workspace">
        <section className="social-feed" aria-label="Trade feed" aria-busy={feed.isLoading}>
          {feed.isLoading ? <div className="social-feed-skeleton" aria-label="Loading activity">
            {Array.from({ length: 3 }, (_, index) => <span className="skeleton" key={index} />)}
          </div> : feed.isError ? <div className="social-feed-state" role="alert"><strong>Activity is unavailable.</strong><p>{feed.error instanceof Error ? feed.error.message : "Try again shortly."}</p><button type="button" onClick={() => void feed.refetch()}>Retry</button></div>
            : !feed.data?.items.length ? <div className="social-feed-state"><strong>{scope === "following" ? "Your following feed is quiet." : "No confirmed trades yet."}</strong><p>{scope === "following" ? "Follow traders from the feed to build your following feed." : "The first indexed curve trade will appear here."}</p></div>
              : <div className="social-feed-list">{feed.data.items.map((trade) => <SocialTradeCard key={trade.id} trade={trade} navigate={navigate} />)}</div>}
        </section>
      </div>
    </main>
  );
}
