import { useMemo } from "react";
import { useAccount } from "wagmi";
import { useStore } from "../app/useStore.js";
import { AppLink } from "../components/Navigation";
import { MarketHeader } from "../components/MarketHeader";
import { MarketTabs } from "../components/MarketTabs";
import { MilestonePanel } from "../components/MilestonePanel";
import { PriceChart } from "../components/PriceChart";
import { TradePanel } from "../components/TradePanel";
import { useFetch } from "../lib/useFetch";
import { mockConfig } from "../lib/mockData";
import type { LaunchpadConfig, Navigate, Token } from "../types";

export function MarketPage({
  token,
  navigate,
  connectWallet,
}: {
  token?: Token;
  navigate: Navigate;
  connectWallet: () => void;
}) {
  const { loading, marketError, actionError } = useStore() as {
    loading: boolean;
    marketError: string;
    actionError: string;
  };
  const { address } = useAccount();
  const { data } = useFetch<LaunchpadConfig | null>("/api/config", null);
  // Dev-only: an unconfigured launchpad falls back to sample settings.
  const config = useMemo(() => data ?? mockConfig(), [data]);
  const error = actionError || marketError;

  if (loading) return <main className="page-status wrap">Loading market…</main>;
  if (!token)
    return (
      <main className="page-status wrap">
        <span className="empty-orbit" />
        <h1>Market not found</h1>
        <p>This curve may not exist, or the API is unavailable.</p>
        <AppLink className="primary-button" route="markets" navigate={navigate}>
          Back to markets
        </AppLink>
      </main>
    );

  return (
    <main className="market-page wrap">
      <AppLink className="back-link" route="markets" navigate={navigate}>
        ← All markets
      </AppLink>

      <MarketHeader token={token} />
      <PriceChart token={token} />
      <TradePanel
        token={token}
        address={address}
        config={config}
        connectWallet={connectWallet}
      />
      <MilestonePanel
        token={token}
        address={address}
        config={config}
        connectWallet={connectWallet}
      />
      <MarketTabs
        token={token}
        address={address}
        connectWallet={connectWallet}
      />

      <p className="disclaimer">
        Market data may be delayed. Nothing here is financial advice.
      </p>

      {error && (
        <p className="notice floating-notice" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
