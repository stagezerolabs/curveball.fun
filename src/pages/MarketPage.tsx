import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { getAddress, isAddress } from "viem";
import { useStore } from "../app/useStore.js";
import { AppLink } from "../components/Navigation";
import { MarketHeader } from "../components/MarketHeader";
import { MarketTabs } from "../components/MarketTabs";
import { MilestonePanel } from "../components/MilestonePanel";
import { TradePanel } from "../components/TradePanel";
import {
  discoverToken,
  type CreatorTokenClient,
} from "../creatorTokens";
import { activeChainId } from "../lib/web3";
import { readableError } from "../lib/errors";
import type { Navigate, Token } from "../types";

export function MarketPage({
  token,
  tokenAddress,
  navigate,
}: {
  token?: Token;
  tokenAddress: string;
  navigate: Navigate;
}) {
  const { loading, marketError, actionError } = useStore() as {
    loading: boolean;
    marketError: string;
    actionError: string;
  };
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: activeChainId });
  const [onchainToken, setOnchainToken] = useState<Token | null>();
  const [discoveryError, setDiscoveryError] = useState("");
  const error = actionError || marketError || discoveryError;
  const resolvedToken = token ?? onchainToken;

  useEffect(() => {
    if (token) {
      setOnchainToken(token);
      setDiscoveryError("");
      return;
    }
    if (!isAddress(tokenAddress)) {
      setOnchainToken(null);
      return;
    }
    if (!publicClient) {
      setOnchainToken(undefined);
      return;
    }

    let active = true;
    setOnchainToken(undefined);
    setDiscoveryError("");
    void discoverToken(
      publicClient as unknown as CreatorTokenClient,
      getAddress(tokenAddress),
    )
      .then((result) => {
        if (active) setOnchainToken(result);
      })
      .catch((cause) => {
        if (!active) return;
        setOnchainToken(null);
        setDiscoveryError(readableError(cause, "Could not read this market from the configured network."));
      });

    return () => {
      active = false;
    };
  }, [publicClient, token, tokenAddress]);

  if (!resolvedToken && (loading || onchainToken === undefined))
    return <main className="page-status wrap">Loading market…</main>;
  if (!resolvedToken)
    return (
      <main className="page-status wrap">
        <span className="empty-orbit" />
        <h1>Market not found</h1>
        <p>This curve does not exist on the configured network.</p>
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

      <MarketHeader token={resolvedToken} />
      <TradePanel
        token={resolvedToken}
        address={address}
      />
      <MilestonePanel
        token={resolvedToken}
        address={address}
      />
      <MarketTabs token={resolvedToken} />

      <p className="disclaimer">
        Market state is read directly from the configured network. Nothing here is financial advice.
      </p>

      {error && (
        <div className="notice notice-dismissible floating-notice" role="alert">
          <span>{error}</span>
          {actionError && (
            <button type="button" onClick={() => useStore.getState().setActionError("")} aria-label="Dismiss error">×</button>
          )}
        </div>
      )}
    </main>
  );
}
