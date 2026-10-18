import type { PrivyClientConfig } from "@privy-io/react-auth";
import { riseTestnet } from "./web3";

export const privyConfig = {
  loginMethods: ["wallet"],
  appearance: {
    theme: "dark",
    accentColor: "#c8f135",
    landingHeader: "Join Curveball",
    loginMessage: "Connect and sign with your wallet to create your Curveball trader profile.",
    walletChainType: "ethereum-only",
  },
  defaultChain: riseTestnet,
  supportedChains: [riseTestnet],
  embeddedWallets: {
    ethereum: { createOnLogin: "users-without-wallets" },
  },
} satisfies PrivyClientConfig;
