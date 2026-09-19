import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain, getAddress, http, isAddress, type Address } from "viem";
import {
  RISE_CHAIN_ID,
  defineCurveballDeployment,
} from "../sdk/curveballSdk";
import { createWagmiCurveballSdk } from "../sdk/wagmiSdk";

export const rise = defineChain({
  id: RISE_CHAIN_ID,
  name: "RISE",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [import.meta.env.VITE_RPC_URL || "https://rpc.risechain.com/"],
    },
  },
  blockExplorers: {
    default: {
      name: "RISE Explorer",
      url: "https://explorer.risechain.com",
    },
  },
});

export const apiUrl = "/api";

export const wagmiConfig = createConfig({
  chains: [rise],
  connectors: [injected()],
  transports: { [rise.id]: http(rise.rpcUrls.default.http[0]) },
});

const configuredLaunchpad = import.meta.env.VITE_LAUNCHPAD_ADDRESS?.trim();

export const launchpadAddress: Address | null =
  configuredLaunchpad && isAddress(configuredLaunchpad)
    ? getAddress(configuredLaunchpad)
    : null;

export const curveballSdk = launchpadAddress
  ? createWagmiCurveballSdk(
      wagmiConfig,
      defineCurveballDeployment({
        chainId: RISE_CHAIN_ID,
        launchpad: launchpadAddress,
        slippageBps: 300,
        deadlineSeconds: 300,
      }),
    )
  : null;

export function requireCurveballSdk() {
  if (!curveballSdk) {
    throw new Error("Curveball mainnet deployment is not configured.");
  }
  return curveballSdk;
}
