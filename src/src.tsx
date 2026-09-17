import { createRoot } from "react-dom/client";
import { WagmiProvider } from "wagmi";
import { App } from "./app/App";
import { wagmiConfig } from "./lib/web3.js";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <WagmiProvider config={wagmiConfig}>
    <App />
  </WagmiProvider>,
);
