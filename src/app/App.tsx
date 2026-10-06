import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
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
import {
  applyTheme,
  readStoredTheme,
  type Theme,
} from "../lib/theme";

export function App() {
  const { navigate, route } = useRouter();
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const { address } = useAccount();

  useEffect(() => applyTheme(theme), [theme]);

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
