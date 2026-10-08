import { useEffect, useMemo } from "react";
import { Heading, Text } from "@radix-ui/themes";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount, usePublicClient } from "wagmi";
import type { Address } from "viem";
import { useStore } from "../app/useStore.js";
import { AppLink } from "../components/Navigation";
import { TokenCard } from "../components/TokenCard";
import type { CreatorTokenClient } from "../creatorTokens";
import { activeChainId } from "../lib/web3";
import type { Navigate, Token } from "../types";

const PROFILE_SKELETON_CARDS = 3;

export function ProfilePage({
  navigate,
}: {
  navigate: Navigate;
}) {
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const publicClient = usePublicClient({ chainId: activeChainId });
  const key = address?.toLowerCase() ?? "";
  const { creatorTokens, creatorErrors, loadCreatorTokens } = useStore() as {
    creatorTokens: Record<string, Token[]>;
    creatorErrors: Record<string, string>;
    loadCreatorTokens: (
      client: CreatorTokenClient | undefined,
      creator: Address,
    ) => Promise<Token[]>;
  };
  const hasCachedResult = Object.prototype.hasOwnProperty.call(creatorTokens, key);
  const tokens = creatorTokens[key] ?? [];
  const error = creatorErrors[key];
  const initialLoading = Boolean(address) && !hasCachedResult && !error;

  useEffect(() => {
    if (!address) return;
    void loadCreatorTokens(
      publicClient as unknown as CreatorTokenClient | undefined,
      address,
    ).catch(() => undefined);
  }, [address, loadCreatorTokens, publicClient]);

  const graduated = useMemo(
    () => tokens.filter((token) => token.graduated).length,
    [tokens],
  );

  if (!address) {
    return (
      <main className="page-main profile-page wrap">
        <header className="workspace-heading">
          <div>
            <Text as="p" className="workspace-eyebrow">Profile</Text>
            <Heading as="h1">Your launches</Heading>
          </div>
        </header>
        <section className="profile-connect" aria-labelledby="profile-connect-title">
          <span className="profile-connect-icon" aria-hidden="true">↗</span>
          <h2 id="profile-connect-title">Connect your wallet</h2>
          <p>See the tokens you created on Curveball.</p>
          <button className="primary-button" type="button" onClick={() => openConnectModal?.()}>
            Connect wallet
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="page-main profile-page wrap">
      <header className="workspace-heading">
        <div>
          <Text as="p" className="workspace-eyebrow">Profile</Text>
          <Heading as="h1">Your launches</Heading>
        </div>
        <Text as="p">Markets created by your connected wallet.</Text>
      </header>

      {initialLoading ? (
        <section className="profile-stats profile-stats-skeleton" aria-busy="true" aria-label="Loading launch summary">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index}><span className="skeleton skeleton-line" /><span className="skeleton skeleton-number" /></div>
          ))}
        </section>
      ) : (
        <section className="profile-stats" aria-label="Launch summary">
          <div><small>Tokens launched</small><strong>{tokens.length}</strong></div>
          <div><small>Curves live</small><strong>{tokens.length - graduated}</strong></div>
          <div><small>Graduated</small><strong>{graduated}</strong></div>
        </section>
      )}

      <section className="profile-markets" aria-live="polite">
        {error && <p className="notice" role="alert">{error}</p>}
        {initialLoading ? (
          <ul className="tcard-grid profile-card-skeletons" aria-busy="true" aria-label="Loading launches">
            {Array.from({ length: PROFILE_SKELETON_CARDS }, (_, index) => (
              <li key={index} className="tcard skeleton" />
            ))}
          </ul>
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
