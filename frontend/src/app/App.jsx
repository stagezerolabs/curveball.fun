import { useEffect } from "react";
import { useAccount, useConnect } from "wagmi";
import { Footer, Header } from "../components/Navigation.jsx";
import { HomePage } from "../pages/HomePage.jsx";
import { LaunchPage } from "../pages/LaunchPage.jsx";
import { MarketPage } from "../pages/MarketPage.jsx";
import { MarketsPage } from "../pages/MarketsPage.jsx";
import { NotFoundPage } from "../pages/NotFoundPage.jsx";
import { useRouter } from "./useRouter.js";
import { useStore } from "./useStore.js";

export function App() {
  const { navigate, route } = useRouter();
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { tokens, loading, fetchTokens } = useStore();

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  const token =
    route.id === "market"
      ? tokens.find(
          (item) =>
            item.address.toLowerCase() === route.params.address.toLowerCase(),
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
      page = <LaunchPage address={address} />;
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
