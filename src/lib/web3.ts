import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { defineChain, getAddress, http, isAddress, type Address } from "viem";
import {
  CURVEBALL_LAUNCHPAD_ADDRESS,
  RISE_TESTNET_CHAIN_ID,
  RISE_TESTNET_EXPLORER_URL,
  RISE_TESTNET_RPC_URL,
  defineCurveballDeployment,
} from "../sdk/curveballSdk";
import { createWagmiCurveballSdk } from "../sdk/wagmiSdk";
import { resolveRiseTestnetRpcUrl } from "./clientRuntime";

const riseTestnetRpcUrl = resolveRiseTestnetRpcUrl(import.meta.env);

export const riseTestnet = defineChain({
  id: RISE_TESTNET_CHAIN_ID,
  name: "RISE Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [riseTestnetRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "RISE Explorer",
      url: RISE_TESTNET_EXPLORER_URL,
    },
  },
});

export const apiUrl = "/api";

export const wagmiConfig = createConfig({
  chains: [riseTestnet],
  connectors: [injected()],
  transports: {
    [riseTestnet.id]: http(riseTestnet.rpcUrls.default.http[0]),
  },
});

const configuredLaunchpad =
  import.meta.env.VITE_LAUNCHPAD_ADDRESS?.trim() ||
  CURVEBALL_LAUNCHPAD_ADDRESS;

export const launchpadAddress: Address | null =
  configuredLaunchpad && isAddress(configuredLaunchpad)
    ? getAddress(configuredLaunchpad)
    : null;

export const curveballSdk = launchpadAddress
  ? createWagmiCurveballSdk(
      wagmiConfig,
      defineCurveballDeployment({
        chainId: RISE_TESTNET_CHAIN_ID,
        launchpad: launchpadAddress,
        slippageBps: 300,
        deadlineSeconds: 300,
      }),
    )
  : null;

export function requireCurveballSdk() {
  if (!curveballSdk) {
    throw new Error("Curveball testnet deployment is not configured.");
  }
  return curveballSdk;
}
