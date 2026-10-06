import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
import type { Chain } from "viem";

export function createWalletConfig(chain: Chain, projectId: string) {
  const transports = { [chain.id]: http(chain.rpcUrls.default.http[0]) };
  return projectId.trim()
    ? getDefaultConfig({
        appName: "Curveball",
        projectId: projectId.trim(),
        chains: [chain],
        transports,
      })
    : createConfig({ chains: [chain], connectors: [injected()], transports });
}
