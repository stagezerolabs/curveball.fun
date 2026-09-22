import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { getAddress, isAddress } from "viem";
import { useStore } from "../app/useStore.js";
import { AppLink } from "../components/Navigation";
import { MarketHeader } from "../components/MarketHeader";
import { MarketTabs } from "../components/MarketTabs";
import { MilestonePanel } from "../components/MilestonePanel";
import { PriceChart } from "../components/PriceChart";
import { TradePanel } from "../components/TradePanel";
import { useFetch } from "../lib/useFetch";
import {
  discoverToken,
  type CreatorTokenClient,
} from "../creatorTokens";
import { RISE_TESTNET_CHAIN_ID } from "../sdk/curveballSdk";
import type { LaunchpadConfig, Navigate, Token } from "../types";

export function MarketPage({
  token,
  tokenAddress,
  navigate,
  connectWallet,
}: {
  token?: Token;
  tokenAddress: string;
  navigate: Navigate;
  connectWallet: () => void;
}) {
  const { loading, marketError, actionError } = useStore() as {
    loading: boolean;
    marketError: string;
    actionError: string;
  };
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: RISE_TESTNET_CHAIN_ID });
  const [onchainToken, setOnchainToken] = useState<Token | null>();
  const [discoveryError, setDiscoveryError] = useState("");
  const { data } = useFetch<LaunchpadConfig | null>("/api/config", null);
  const config = data;
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
        setDiscoveryError(
          cause instanceof Error
            ? cause.message
            : "Could not read this market from RISE Testnet.",
        );
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

      <MarketHeader token={resolvedToken} />
      <PriceChart token={resolvedToken} />
      <TradePanel
        token={resolvedToken}
        address={address}
        config={config}
        connectWallet={connectWallet}
      />
      <MilestonePanel
        token={resolvedToken}
        address={address}
        config={config}
        connectWallet={connectWallet}
      />
      <MarketTabs
        token={resolvedToken}
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
