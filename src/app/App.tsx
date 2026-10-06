import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import {
  Footer,
  Header,
  LandingFooter,
  LandingHeader,
} from "../components/Navigation";
import { HomePage } from "../pages/HomePage";
import { LandingPage } from "../pages/LandingPage";
import { LaunchPage } from "../pages/LaunchPage";
import { MarketPage } from "../pages/MarketPage";
import { MarketsPage } from "../pages/MarketsPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ProfilePage } from "../pages/ProfilePage";
import { useRouter } from "./useRouter.js";
import { useStore } from "./useStore.js";
import type { Token } from "../types";
import {
  discoverAllTokens,
  discoverToken,
  type CreatorTokenClient,
} from "../creatorTokens";
import { activeChainId } from "../lib/web3";
import {
  applyTheme,
  readStoredTheme,
  type Theme,
} from "../lib/theme";

export function App() {
  const { navigate, route } = useRouter();
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: activeChainId });
  const { tokens, loading, fetchTokens, mergeTokens, lastCreatedToken } = useStore() as {
    tokens: Token[];
    loading: boolean;
    fetchTokens: () => Promise<boolean>;
    mergeTokens: (tokens: Token[]) => void;
    lastCreatedToken: `0x${string}` | null;
  };

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const indexed = await fetchTokens();
      if (indexed || !active || !publicClient) return;
      try {
        const discovered = await discoverAllTokens(
          publicClient as unknown as CreatorTokenClient,
        );
        if (active) mergeTokens(discovered);
      } catch {
        // The indexed API remains usable if the public RPC is temporarily unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchTokens, mergeTokens, publicClient]);

  useEffect(() => {
    if (!lastCreatedToken || !publicClient) return;
    let active = true;
    void discoverToken(publicClient as unknown as CreatorTokenClient, lastCreatedToken)
      .then((created) => {
        if (active && created) mergeTokens([created]);
      })
      .catch(() => {
        // The confirmed receipt remains visible in the launch message while
        // the finalized indexer catches up.
      });
    return () => { active = false; };
  }, [lastCreatedToken, mergeTokens, publicClient]);

  // Keep indexed market data fresh without overlapping requests. Store actions
  // refresh immediately after create, trade, and graduation; this only covers
  // trades other wallets make while the tab stays open.
  useEffect(() => {
    let inFlight = false;
    const refresh = async () => {
      if (inFlight || document.hidden) return;
      inFlight = true;
      try {
        await fetchTokens();
      } finally {
        inFlight = false;
      }
    };
    const interval = window.setInterval(() => void refresh(), 15000);
    const onVisibility = () => {
      if (!document.hidden) void refresh();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [fetchTokens]);

  const token: Token | undefined =
    route.id === "market"
      ? tokens.find(
          (item) =>
            item.address.toLowerCase() ===
            (route.params as { address: string }).address.toLowerCase(),
        )
      : undefined;

  let page;
  switch (route.id) {
    case "landing":
      page = <LandingPage navigate={navigate} />;
      break;
    case "home":
      page = <HomePage navigate={navigate} />;
      break;
    case "markets":
      page = <MarketsPage navigate={navigate} />;
      break;
    case "market":
      page = (
        <MarketPage
          navigate={navigate}
          token={token}
          tokenAddress={(route.params as { address: string }).address}
        />
      );
      break;
    case "launch":
      page = <LaunchPage navigate={navigate} />;
      break;
    case "profile":
      page = (
        <ProfilePage navigate={navigate} />
      );
      break;
    default:
      page = <NotFoundPage navigate={navigate} />;
  }

  const toggleTheme = () =>
    setTheme((current) => (current === "light" ? "dark" : "light"));
  const isLanding = route.id === "landing";

  return (
    <div className="site-shell">
      {isLanding ? (
        <LandingHeader
          address={address}
          navigate={navigate}
          theme={theme}
          onThemeToggle={toggleTheme}
        />
      ) : (
        <Header
          address={address}
          navigate={navigate}
          routeId={route.id}
          theme={theme}
          onThemeToggle={toggleTheme}
        />
      )}
      {page}
      {isLanding ? (
        <LandingFooter navigate={navigate} />
      ) : (
        <Footer navigate={navigate} />
      )}
    </div>
  );
}
