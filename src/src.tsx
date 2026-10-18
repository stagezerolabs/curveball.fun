import { createRoot } from "react-dom/client";
import { PrivyProvider } from "@privy-io/react-auth";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { privyConfig } from "./lib/privyConfig";
import { PrivyWagmiProvider } from "./lib/PrivyWagmiProvider";
import { ProfileClaimSync } from "./social/ProfileClaimSync";
import { wagmiConfig } from "./lib/web3";
import "./style.css";

const queryClient = new QueryClient();
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
