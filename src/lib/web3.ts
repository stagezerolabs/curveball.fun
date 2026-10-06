import { defineChain, getAddress, isAddress, type Address } from "viem";
import {
  CURVEBALL_LAUNCHPAD_ADDRESS,
  RISE_MAINNET_CHAIN_ID,
  RISE_MAINNET_EXPLORER_URL,
  RISE_TESTNET_CHAIN_ID,
  RISE_TESTNET_EXPLORER_URL,
  RISE_TESTNET_RPC_URL,
  defineCurveballDeployment,
} from "../sdk/curveballSdk";
import { createWagmiCurveballSdk } from "../sdk/wagmiSdk";
import { createV2Sdk } from "../sdk/v2Sdk";
import { resolveContractVersion, resolveRiseTestnetRpcUrl } from "./clientRuntime";
import { createWalletConfig } from "./walletConfig";

const riseTestnetRpcUrl = resolveRiseTestnetRpcUrl(import.meta.env);
export const activeContractVersion = resolveContractVersion(import.meta.env);
export const activeChainId = Number(import.meta.env.VITE_CHAIN_ID || RISE_TESTNET_CHAIN_ID);
export const activeExplorerUrl = activeChainId === RISE_MAINNET_CHAIN_ID
  ? RISE_MAINNET_EXPLORER_URL
  : RISE_TESTNET_EXPLORER_URL;
export const activeDeploymentBlock = BigInt(
  import.meta.env.VITE_DEPLOYMENT_BLOCK ||
    (activeChainId === RISE_TESTNET_CHAIN_ID ? "55002177" : "0"),
);

export const riseTestnet = defineChain({
  id: activeChainId,
  name: activeChainId === RISE_MAINNET_CHAIN_ID ? "RISE Mainnet" : activeChainId === 31_337 ? "Local Anvil" : "RISE Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: {
      http: [riseTestnetRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: "RISE Explorer",
      url: activeExplorerUrl,
    },
  },
});

export const wagmiConfig = createWalletConfig(riseTestnet, import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || "");

const configuredLaunchpad =
  import.meta.env.VITE_LAUNCHPAD_ADDRESS?.trim() ||
  (activeChainId === RISE_TESTNET_CHAIN_ID ? CURVEBALL_LAUNCHPAD_ADDRESS : "");
if (activeChainId === RISE_MAINNET_CHAIN_ID && (!configuredLaunchpad || !import.meta.env.VITE_DEPLOYMENT_BLOCK)) {
  throw new Error("Mainnet requires VITE_LAUNCHPAD_ADDRESS and VITE_DEPLOYMENT_BLOCK.");
}
if (activeChainId === RISE_MAINNET_CHAIN_ID && configuredLaunchpad.toLowerCase() === CURVEBALL_LAUNCHPAD_ADDRESS.toLowerCase()) {
  throw new Error("The archived mainnet launchpad cannot be used for v2.");
}

export const launchpadAddress: Address | null =
  configuredLaunchpad && isAddress(configuredLaunchpad)
    ? getAddress(configuredLaunchpad)
    : null;

const deployment = launchpadAddress ? defineCurveballDeployment({
  chainId: activeChainId,
  launchpad: launchpadAddress,
  slippageBps: 300,
  deadlineSeconds: 300,
}) : null;
export const curveballSdk = deployment
  ? activeContractVersion === "v2"
    ? createV2Sdk(wagmiConfig, deployment)
    : createWagmiCurveballSdk(wagmiConfig, deployment)
  : null;

export function requireCurveballSdk() {
  if (!curveballSdk) {
    throw new Error("Curveball deployment is not configured.");
  }
  return curveballSdk;
}
