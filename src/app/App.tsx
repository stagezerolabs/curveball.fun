import { useEffect, useState } from "react";
import { useAccount, useConnect, usePublicClient } from "wagmi";
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
  type CreatorTokenClient,
} from "../creatorTokens";
import { RISE_TESTNET_CHAIN_ID } from "../sdk/curveballSdk";
import {
  applyTheme,
  readStoredTheme,
  type Theme,
} from "../lib/theme";

export function App() {
  const { navigate, route } = useRouter();
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const publicClient = usePublicClient({ chainId: RISE_TESTNET_CHAIN_ID });
  const connectWallet = () => connect({ connector: connectors[0] });
  const { tokens, loading, fetchTokens, mergeTokens } = useStore() as {
    tokens: Token[];
    loading: boolean;
    fetchTokens: () => Promise<void>;
    mergeTokens: (tokens: Token[]) => void;
  };

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    let active = true;
    void (async () => {
      await fetchTokens();
      if (!active || !publicClient) return;
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
          connectWallet={connectWallet}
        />
      );
      break;
    case "launch":
      page = <LaunchPage />;
      break;
    case "profile":
      page = (
        <ProfilePage navigate={navigate} connectWallet={connectWallet} />
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
          connectWallet={connectWallet}
          navigate={navigate}
          theme={theme}
          onThemeToggle={toggleTheme}
        />
      ) : (
        <Header
          address={address}
          connectWallet={connectWallet}
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
