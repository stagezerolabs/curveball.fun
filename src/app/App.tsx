import { useEffect } from "react";
import { useAccount, useConnect } from "wagmi";
import { Footer, Header } from "../components/Navigation";
import { HomePage } from "../pages/HomePage";
import { LaunchPage } from "../pages/LaunchPage";
import { MarketPage } from "../pages/MarketPage";
import { MarketsPage } from "../pages/MarketsPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { useRouter } from "./useRouter.js";
import { useStore } from "./useStore.js";
import type { Token } from "../types";

export function App() {
  const { navigate, route } = useRouter();
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { tokens, loading, fetchTokens } = useStore() as {
    tokens: Token[];
    loading: boolean;
    fetchTokens: () => Promise<void>;
  };

  useEffect(() => {
    fetchTokens();
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
    case "home":
      page = <HomePage navigate={navigate} />;
      break;
    case "markets":
      page = <MarketsPage navigate={navigate} />;
      break;
    case "market":
      page = <MarketPage navigate={navigate} token={token} />;
      break;
    case "launch":
      page = <LaunchPage />;
      break;
    default:
      page = <NotFoundPage navigate={navigate} />;
  }

  return (
    <div className="site-shell">
      <Header
        address={address}
        connectWallet={() => connect({ connector: connectors[0] })}
        navigate={navigate}
        routeId={route.id}
      />
      {page}
      <Footer navigate={navigate} />
    </div>
  );
}
