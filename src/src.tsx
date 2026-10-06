import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { wagmiConfig } from "./lib/web3";
import { walletThemeCss } from "./lib/walletTheme";
import "./style.css";
import "@rainbow-me/rainbowkit/styles.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <WagmiProvider config={wagmiConfig}>
      <ErrorBoundary>
        <RainbowKitProvider theme={null} modalSize="compact">
          <style>{walletThemeCss}</style>
          <App />
        </RainbowKitProvider>
      </ErrorBoundary>
    </WagmiProvider>
  </QueryClientProvider>,
);
