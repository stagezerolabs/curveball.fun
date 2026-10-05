import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { AppLink } from "../components/Navigation";
import { TokenCard } from "../components/TokenCard";
import {
  discoverCreatorTokens,
  type CreatorTokenClient,
} from "../creatorTokens";
import { formatAddress } from "../lib/format.js";
import { activeChainId, activeDeploymentBlock, activeExplorerUrl } from "../lib/web3";
import type { Navigate, Token } from "../types";

export function ProfilePage({
  navigate,
  connectWallet,
}: {
  navigate: Navigate;
  connectWallet: () => void;
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: activeChainId });
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!address || !publicClient) {
      setTokens([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setTokens(
        await discoverCreatorTokens(
          publicClient as unknown as CreatorTokenClient,
          address as Address,
        ),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not read this wallet's launches from the configured network.",
      );
    } finally {
      setLoading(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    void load();
  }, [load]);

  const graduated = useMemo(
    () => tokens.filter((token) => token.graduated).length,
    [tokens],
  );

  if (!address) {
    return (
      <main className="page-main profile-page wrap">
        <section className="profile-connect">
          <div className="eyebrow"><span /> Your launches</div>
          <h1>Connect to see what you built.</h1>
          <p>Your dashboard is derived directly from launchpad events.</p>
          <button className="primary-button" onClick={connectWallet}>
            Connect wallet
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-main profile-page wrap">
      <header className="profile-heading">
        <div>
          <div className="eyebrow"><span /> Creator dashboard</div>
          <h1>Your launches</h1>
          <p>Every token created by this wallet on this launchpad.</p>
        </div>
        <div className="profile-identity">
          <span className="wallet-dot connected" aria-hidden="true" />
          <strong>{formatAddress(address)}</strong>
          <a
            href={`${activeExplorerUrl}/address/${address}`}
            target="_blank"
            rel="noreferrer"
          >
            View wallet ↗
          </a>
        </div>
      </header>

      <section className="profile-stats" aria-label="Launch summary">
        <div><small>Tokens launched</small><strong>{tokens.length}</strong></div>
        <div><small>Curves live</small><strong>{tokens.length - graduated}</strong></div>
        <div><small>Graduated</small><strong>{graduated}</strong></div>
      </section>

      <section className="profile-markets" aria-live="polite">
        <div className="profile-section-head">
          <div>
            <span>Deployed tokens</span>
            <small>Read directly from block {activeDeploymentBlock.toString()}</small>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        {error && <p className="notice" role="alert">{error}</p>}
        {loading && !tokens.length ? (
          <p className="profile-loading">Reading your launches from chain…</p>
        ) : !tokens.length ? (
          <div className="profile-empty">
            <strong>No launches from this wallet yet.</strong>
            <p>Create a token and it will appear here after confirmation.</p>
            <AppLink className="primary-button" route="launch" navigate={navigate}>
              Launch a token
            </AppLink>
          </div>
        ) : (
          <ul className="tcard-grid">
            {tokens.map((token, index) => (
              <TokenCard
                key={token.address}
                token={token}
                index={index}
                navigate={navigate}
              />
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
