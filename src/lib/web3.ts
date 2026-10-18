import { createConfig, http } from "wagmi";
import { defineChain, getAddress, isAddress, type Address } from "viem";
import {
  RISE_MAINNET_CHAIN_ID,
  RISE_MAINNET_EXPLORER_URL,
  RISE_MAINNET_RPC_URL,
  RISE_TESTNET_CHAIN_ID,
  RISE_TESTNET_EXPLORER_URL,
  RISE_TESTNET_RPC_URL,
  defineCurveballDeployment,
} from "../sdk/curveballSdk";
import { createCurveballSdk } from "../sdk/sdk";

const env = import.meta.env;
if (!env.VITE_LAUNCHPAD_ADDRESS) throw new Error("VITE_LAUNCHPAD_ADDRESS is required.");
if (!env.VITE_DEPLOYMENT_BLOCK) throw new Error("VITE_DEPLOYMENT_BLOCK is required.");

export const activeChainId = Number(env.VITE_CHAIN_ID || RISE_TESTNET_CHAIN_ID);
if (![RISE_TESTNET_CHAIN_ID, RISE_MAINNET_CHAIN_ID, 31_337].includes(activeChainId)) {
  throw new Error("VITE_CHAIN_ID must select RISE Testnet, RISE mainnet, or local Anvil.");
}
const configuredRpc = typeof env.VITE_RPC_URL === "string" ? env.VITE_RPC_URL.trim() : "";
const rpcUrl = configuredRpc && env.VITE_CHAIN_ID
  ? configuredRpc
  : activeChainId === RISE_MAINNET_CHAIN_ID ? RISE_MAINNET_RPC_URL
  : activeChainId === 31_337 ? "http://127.0.0.1:8545"
  : RISE_TESTNET_RPC_URL;

export const activeExplorerUrl = activeChainId === RISE_MAINNET_CHAIN_ID
  ? RISE_MAINNET_EXPLORER_URL
  : RISE_TESTNET_EXPLORER_URL;
export const isActiveTestnet = activeChainId !== RISE_MAINNET_CHAIN_ID;
export const activeDeploymentBlock = BigInt(env.VITE_DEPLOYMENT_BLOCK);

export const riseTestnet = defineChain({
  id: activeChainId,
  name: activeChainId === RISE_MAINNET_CHAIN_ID ? "RISE Mainnet" : activeChainId === 31_337 ? "Local Anvil" : "RISE Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "RISE Explorer", url: activeExplorerUrl } },
  testnet: isActiveTestnet,
});

// Public RPCs drop log queries under load; viem retries with exponential backoff.
const transports = { [riseTestnet.id]: http(rpcUrl, { retryCount: 5, retryDelay: 500 }) };
export const wagmiConfig = createConfig({
  chains: [riseTestnet],
  transports,
  ssr: true,
  multiInjectedProviderDiscovery: false,
});

const configuredLaunchpad = env.VITE_LAUNCHPAD_ADDRESS.trim();
export const launchpadAddress: Address | null = isAddress(configuredLaunchpad) ? getAddress(configuredLaunchpad) : null;
export const curveballSdk = launchpadAddress
  ? createCurveballSdk(wagmiConfig, defineCurveballDeployment({
      chainId: activeChainId,
      launchpad: launchpadAddress,
      slippageBps: 300,
      deadlineSeconds: 300,
    }))
  : null;

export function requireCurveballSdk() {
  if (!curveballSdk) throw new Error("Curveball deployment is not configured.");
  return curveballSdk;
}
