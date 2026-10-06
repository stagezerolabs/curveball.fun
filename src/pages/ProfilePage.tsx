import { useCallback, useEffect, useMemo, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { AppLink } from "../components/Navigation";
import { TokenCard } from "../components/TokenCard";
import {
  discoverCreatorTokens,
  type CreatorTokenClient,
} from "../creatorTokens";
import { activeChainId } from "../lib/web3";
import { readableError } from "../lib/errors";
import type { Navigate, Token } from "../types";

export function ProfilePage({
  navigate,
}: {
  navigate: Navigate;
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
      setError(readableError(cause, "Could not read this wallet's launches from the configured network."));
    } finally {
      setLoading(false);
    }
  }, [address, publicClient]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!address) navigate("home");
  }, [address, navigate]);

  const graduated = useMemo(
    () => tokens.filter((token) => token.graduated).length,
    [tokens],
  );

  if (!address) return null;

  return (
    <main className="page-main profile-page wrap">
      <header className="profile-heading">
        <div>
          <div className="eyebrow"><span /> Creator dashboard</div>
          <h1>Your launches</h1>
          <p>Every token created by this wallet on this launchpad.</p>
        </div>
      </header>

      <section className="profile-stats" aria-label="Launch summary">
        <div><small>Tokens launched</small><strong>{tokens.length}</strong></div>
        <div><small>Curves live</small><strong>{tokens.length - graduated}</strong></div>
        <div><small>Graduated</small><strong>{graduated}</strong></div>
      </section>

      <section className="profile-markets" aria-live="polite">
        {error && <p className="notice" role="alert">{error}</p>}
        {loading && !tokens.length ? (
          <p className="profile-loading">Loading…</p>
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
