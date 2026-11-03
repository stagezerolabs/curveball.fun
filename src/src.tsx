import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { privyConfig } from "./lib/privyConfig";
import { PrivyWagmiProvider } from "./lib/PrivyWagmiProvider";
import { ProfileClaimSync } from "./social/ProfileClaimSync";
import {
  activeChainId,
  activeDeploymentBlock,
  launchpadAddress,
  wagmiConfig,
} from "./lib/web3";
import "./style.css";

// A redeployment gives every market a new address. Remove saved data from other
// launchpads on this chain while retaining the current deployment's cache.
try {
  const chainCachePrefix = `curveball-chain-cache:${activeChainId}:`;
  const currentChainCache = `${chainCachePrefix}${launchpadAddress ?? "unconfigured"}:current`;
  const statsPrefix = `curveball:landing-stats:current:${activeChainId}:`;
  const currentStatsPrefix = `${statsPrefix}${launchpadAddress?.toLowerCase() ?? ""}:${activeDeploymentBlock}:`;
  for (let i = window.localStorage.length - 1; i >= 0; i -= 1) {
    const key = window.localStorage.key(i);
    if (
      key &&
      ((key.startsWith(chainCachePrefix) && key !== currentChainCache) ||
        (key.startsWith(statsPrefix) && !key.startsWith(currentStatsPrefix)))
    ) {
      window.localStorage.removeItem(key);
    }
  }
} catch {
  // Browser storage may be disabled; the live app does not require it.
}

// Defaults kill the window-focus refetch storm: without them react-query refetches
// every active query (Pulse feed, balances, RNS, charts) on every tab focus.
// Per-query overrides still apply; social feeds opt back in where fresh data matters.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
    },
  },
});
const privyAppId = String(import.meta.env.VITE_PRIVY_APP_ID || "").trim();
const privyClientId = String(import.meta.env.VITE_PRIVY_CLIENT_ID || "").trim();
if (!privyAppId) throw new Error("VITE_PRIVY_APP_ID is required.");

createRoot(document.getElementById("root")!).render(
  <PrivyProvider
    appId={privyAppId}
    clientId={privyClientId || undefined}
    config={privyConfig}
  >
    <QueryClientProvider client={queryClient}>
      <PrivyWagmiProvider config={wagmiConfig}>
        <ProfileClaimSync />
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </PrivyWagmiProvider>
    </QueryClientProvider>
  </PrivyProvider>,
);
