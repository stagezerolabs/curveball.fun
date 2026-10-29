import { lazy, Suspense, useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useAccount } from "wagmi";
import { Header, LandingFooter, LandingHeader } from "../components/Navigation";
import { MarketTape } from "../components/MarketTape";
import { LandingPage } from "../pages/LandingPage";
import { useRouter } from "./useRouter.js";
import { useSocialStream } from "../social/useNotifications";
import { isAdminAddress } from "../lib/adminAccess";
import { applyTheme, readStoredTheme, type Theme } from "../lib/theme";

// Route-level code splitting: the launchpad SDK, wagmi reads, echarts, and the
// social API are heavy; loading them only when their route is visited keeps the
// first meaningful paint (landing + shell) lean for repeated visitors.
const MarketsPage = lazy(() =>
  import("../pages/MarketsPage").then((module) => ({
    default: module.MarketsPage,
  })),
);
const LaunchPage = lazy(() =>
  import("../pages/LaunchPage").then((module) => ({
    default: module.LaunchPage,
  })),
);
const MarketPage = lazy(() =>
  import("../pages/MarketPage").then((module) => ({
    default: module.MarketPage,
  })),
);
const ProfilePage = lazy(() =>
  import("../pages/ProfilePage").then((module) => ({
    default: module.ProfilePage,
  })),
);
const StatsPage = lazy(() =>
  import("../pages/StatsPage").then((module) => ({
    default: module.StatsPage,
  })),
);
const AdminPage = lazy(() =>
  import("../pages/AdminPage").then((module) => ({
    default: module.AdminPage,
  })),
);
const NotFoundPage = lazy(() =>
  import("../pages/NotFoundPage").then((module) => ({
    default: module.NotFoundPage,
  })),
);
const SocialPage = lazy(() =>
  import("../pages/SocialPage").then((module) => ({
    default: module.SocialPage,
  })),
);
const NotificationsPage = lazy(() =>
  import("../pages/NotificationsPage").then((module) => ({
    default: module.NotificationsPage,
  })),
);
const TraderProfilePage = lazy(() =>
  import("../pages/TraderProfilePage").then((module) => ({
    default: module.TraderProfilePage,
  })),
);

function SocialPageFallback() {
  return (
    <main
      className="page-main wrap"
      aria-busy="true"
      aria-label="Loading social trading"
    >
      <div className="trader-profile-skeleton skeleton" />
    </main>
  );
}

function PageFallback() {
  return (
    <main className="page-main wrap" aria-busy="true" aria-label="Loading page">
      <div className="trader-profile-skeleton skeleton" />
    </main>
  );
}

export function App() {
  const { navigate, route } = useRouter();
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const { address } = useAccount();
  const { authenticated, ready: privyReady } = usePrivy();
  const isAdmin = isAdminAddress(address);
  const adminAccessReady = privyReady && (!authenticated || Boolean(address));
  useSocialStream();

  useEffect(() => applyTheme(theme), [theme]);
  useEffect(() => {
    if (route.id === "admin" && adminAccessReady && !isAdmin)
      navigate("markets");
  }, [adminAccessReady, isAdmin, navigate, route.id]);

  let page;
  switch (route.id) {
    case "landing":
      page = <LandingPage navigate={navigate} />;
      break;
    case "markets":
      page = (
        <Suspense fallback={<PageFallback />}>
          <MarketsPage navigate={navigate} />
        </Suspense>
      );
      break;
    case "stats":
      page = (
        <Suspense fallback={<PageFallback />}>
          <StatsPage navigate={navigate} />
        </Suspense>
      );
      break;
    case "social":
      page = (
        <Suspense fallback={<SocialPageFallback />}>
          <SocialPage navigate={navigate} />
        </Suspense>
      );
      break;
    case "notifications":
      page = (
        <Suspense fallback={<PageFallback />}>
          <NotificationsPage navigate={navigate} />
        </Suspense>
      );
      break;
    case "market":
      page = (
        <Suspense fallback={<PageFallback />}>
          <MarketPage
            navigate={navigate}
            tokenAddress={(route.params as { address: string }).address}
          />
        </Suspense>
      );
      break;
    case "launch":
      page = (
        <Suspense fallback={<PageFallback />}>
          <LaunchPage navigate={navigate} />
        </Suspense>
      );
      break;
    case "profile":
      page = (
        <Suspense fallback={<PageFallback />}>
          <ProfilePage key={route.id} navigate={navigate} />
        </Suspense>
      );
      break;
    case "trader":
      page = (
        <Suspense fallback={<SocialPageFallback />}>
          <TraderProfilePage
            navigate={navigate}
            address={(route.params as { address: string }).address}
          />
        </Suspense>
      );
      break;
    case "admin":
      page = isAdmin ? (
        <Suspense fallback={<PageFallback />}>
          <AdminPage />
        </Suspense>
      ) : (
        <main className="page-main wrap" aria-busy="true" aria-label="Loading">
          <div className="trader-profile-skeleton skeleton" />
        </main>
      );
      break;
    default:
      page = (
        <Suspense fallback={<PageFallback />}>
          <NotFoundPage navigate={navigate} />
        </Suspense>
      );
  }

  const toggleTheme = () =>
    setTheme((current) => (current === "light" ? "dark" : "light"));
  const isLanding = route.id === "landing";

  return (
    <div className="site-shell curveball-theme">
      {isLanding ? (
        <LandingHeader
          address={address}
          isAdmin={isAdmin}
          navigate={navigate}
          theme={theme}
          onThemeToggle={toggleTheme}
        />
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
      <MarketTape />
      {page}
      {isLanding && <LandingFooter navigate={navigate} theme={theme} />}
    </div>
  );
}
