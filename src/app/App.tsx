import { lazy, Suspense, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import {
  Header,
  LandingFooter,
  LandingHeader,
} from "../components/Navigation";
import { LandingPage } from "../pages/LandingPage";
import { LaunchPage } from "../pages/LaunchPage";
import { MarketPage } from "../pages/MarketPage";
import { MarketsPage } from "../pages/MarketsPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { NotificationsPage } from "../pages/NotificationsPage";
import { ProfilePage } from "../pages/ProfilePage";
import { StatsPage } from "../pages/StatsPage";
import { AdminPage } from "../pages/AdminPage";
import { useRouter } from "./useRouter.js";
import { isAdminAddress } from "../lib/adminAccess";
import { useSocialEvents } from "../social/useSocialEvents";
import {
  applyTheme,
  readStoredTheme,
  type Theme,
} from "../lib/theme";

const SocialPage = lazy(() => import("../pages/SocialPage").then((module) => ({ default: module.SocialPage })));
const TraderProfilePage = lazy(() => import("../pages/TraderProfilePage").then((module) => ({ default: module.TraderProfilePage })));

function SocialPageFallback() {
  return <main className="page-main wrap" aria-busy="true" aria-label="Loading social trading"><div className="trader-profile-skeleton skeleton" /></main>;
}

export function App() {
  useSocialEvents();
  const { navigate, route } = useRouter();
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const { address } = useAccount();
  const { authenticated, ready: privyReady } = usePrivy();
  const isAdmin = isAdminAddress(address);
  const adminAccessReady = privyReady && (!authenticated || Boolean(address));

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    if (route.id === "admin" && adminAccessReady && !isAdmin) navigate("markets");
  }, [adminAccessReady, isAdmin, navigate, route.id]);

  let page;
  switch (route.id) {
    case "landing":
      page = <LandingPage navigate={navigate} />;
      break;
    case "markets":
      page = <MarketsPage navigate={navigate} />;
      break;
    case "stats":
      page = <StatsPage navigate={navigate} />;
      break;
    case "social":
      page = <Suspense fallback={<SocialPageFallback />}><SocialPage navigate={navigate} /></Suspense>;
      break;
    case "notifications":
      page = <NotificationsPage navigate={navigate} />;
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
    case "profileSettings":
      page = (
        <ProfilePage key={route.id} navigate={navigate} initialTab={route.id === "profileSettings" ? "settings" : undefined} />
      );
      break;
    case "trader":
      page = <Suspense fallback={<SocialPageFallback />}><TraderProfilePage navigate={navigate} address={(route.params as { address: string }).address} /></Suspense>;
      break;
    case "admin":
      page = isAdmin
        ? <AdminPage />
        : <main className="page-main wrap" aria-busy="true" aria-label="Loading"><div className="trader-profile-skeleton skeleton" /></main>;
      break;
    default:
      page = <NotFoundPage navigate={navigate} />;
  }

  const toggleTheme = () =>
    setTheme((current) => (current === "light" ? "dark" : "light"));
  const isLanding = route.id === "landing";

  return (
    <div className="site-shell curveball-theme">
      {isLanding ? (
        <LandingHeader address={address} isAdmin={isAdmin} navigate={navigate} theme={theme} onThemeToggle={toggleTheme} />
      ) : (
        <Header
          address={address}
          isAdmin={isAdmin}
          navigate={navigate}
          routeId={route.id}
          theme={theme}
          onThemeToggle={toggleTheme}
        />
      )}
      {page}
      {isLanding && <LandingFooter navigate={navigate} />}
    </div>
  );
}
