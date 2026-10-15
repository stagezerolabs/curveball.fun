import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors";
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
import { createV2Sdk } from "../sdk/v2Sdk";
import testnetV2 from "../../deployments/11155931/curveball-v2-permissionless.json";
import earlyTestnetV2 from "../../deployments/11155931/curveball-v2-early.json";

const firstTestnetV2 = { address: getAddress(earlyTestnetV2.factory), deploymentBlock: BigInt(earlyTestnetV2.deploymentBlock) };

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
export const activeDeploymentBlock = BigInt(env.VITE_DEPLOYMENT_BLOCK);

export const riseTestnet = defineChain({
  id: activeChainId,
  name: activeChainId === RISE_MAINNET_CHAIN_ID ? "RISE Mainnet" : activeChainId === 31_337 ? "Local Anvil" : "RISE Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "RISE Explorer", url: activeExplorerUrl } },
});

const walletConnectProjectId = (env.VITE_WALLETCONNECT_PROJECT_ID || "").trim();
// Public RPCs drop log queries under load; viem retries with exponential backoff.
const transports = { [riseTestnet.id]: http(rpcUrl, { retryCount: 5, retryDelay: 500 }) };
export const wagmiConfig = walletConnectProjectId
  ? getDefaultConfig({ appName: "Curveball", projectId: walletConnectProjectId, chains: [riseTestnet], transports })
  : createConfig({ chains: [riseTestnet], connectors: [injected()], transports });

const configuredLaunchpad = env.VITE_LAUNCHPAD_ADDRESS.trim();
export const launchpadAddress: Address | null = isAddress(configuredLaunchpad) ? getAddress(configuredLaunchpad) : null;
const legacyAddress = typeof env.VITE_LEGACY_LAUNCHPAD_ADDRESS === "string" ? env.VITE_LEGACY_LAUNCHPAD_ADDRESS.trim() : "";
const legacyBlock = typeof env.VITE_LEGACY_DEPLOYMENT_BLOCK === "string" ? env.VITE_LEGACY_DEPLOYMENT_BLOCK.trim() : "";
const configuredLegacy = isAddress(legacyAddress) && /^\d+$/.test(legacyBlock)
  ? [{ address: getAddress(legacyAddress), deploymentBlock: BigInt(legacyBlock) }] : [];
const testnetLegacy = activeChainId === RISE_TESTNET_CHAIN_ID
  ? [firstTestnetV2, { address: getAddress(testnetV2.factory), deploymentBlock: BigInt(testnetV2.deploymentBlock) }] : [];
export const legacyFactories: ReadonlyArray<{ address: Address; deploymentBlock: bigint }> =
  [...configuredLegacy, ...testnetLegacy].filter((entry, index, all) =>
    entry.address.toLowerCase() !== launchpadAddress?.toLowerCase()
      && all.findIndex((candidate) => candidate.address.toLowerCase() === entry.address.toLowerCase()) === index);
export const activeFactoryIsLegacy = launchpadAddress != null &&
  (activeChainId === RISE_TESTNET_CHAIN_ID && testnetLegacy.some((entry) => entry.address.toLowerCase() === launchpadAddress.toLowerCase())
    || configuredLegacy.some((entry) => entry.address.toLowerCase() === launchpadAddress.toLowerCase()));
export const activeFactoryVersion = (typeof env.VITE_FACTORY_VERSION === "string" && env.VITE_FACTORY_VERSION.trim())
  || (activeChainId === RISE_TESTNET_CHAIN_ID && !activeFactoryIsLegacy ? "V2.1" : "V2");

export function factoryVersion(factory?: Address | null): string {
  if (!factory) return activeFactoryVersion;
  if (activeChainId === RISE_TESTNET_CHAIN_ID && factory.toLowerCase() === firstTestnetV2.address.toLowerCase()) return "V2 early";
  if (activeChainId === RISE_TESTNET_CHAIN_ID && factory.toLowerCase() === testnetV2.factory.toLowerCase()) return "V2";
  return factory.toLowerCase() === launchpadAddress?.toLowerCase() ? activeFactoryVersion : "V2";
}

export const curveballSdk = launchpadAddress
  ? createV2Sdk(wagmiConfig, defineCurveballDeployment({
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
