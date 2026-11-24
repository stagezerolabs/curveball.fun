import { createConfig, http } from "wagmi";
import { defineChain, getAddress, isAddress, type Address, type Hex } from "viem";
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
if (!env.VITE_LAUNCHPAD_ADDRESS)
  throw new Error("VITE_LAUNCHPAD_ADDRESS is required.");
if (!env.VITE_DEPLOYMENT_BLOCK)
  throw new Error("VITE_DEPLOYMENT_BLOCK is required.");

export const activeChainId = Number(env.VITE_CHAIN_ID || RISE_TESTNET_CHAIN_ID);
if (
  ![RISE_TESTNET_CHAIN_ID, RISE_MAINNET_CHAIN_ID, 31_337].includes(
    activeChainId,
  )
) {
  throw new Error(
    "VITE_CHAIN_ID must select RISE Testnet, RISE mainnet, or local Anvil.",
  );
}
const configuredRpc =
  typeof env.VITE_RPC_URL === "string" ? env.VITE_RPC_URL.trim() : "";
const rpcUrl =
  configuredRpc && env.VITE_CHAIN_ID
    ? configuredRpc
    : activeChainId === RISE_MAINNET_CHAIN_ID
      ? RISE_MAINNET_RPC_URL
      : activeChainId === 31_337
        ? "http://127.0.0.1:8545"
        : RISE_TESTNET_RPC_URL;

export const activeExplorerUrl =
  activeChainId === RISE_MAINNET_CHAIN_ID
    ? RISE_MAINNET_EXPLORER_URL
    : RISE_TESTNET_EXPLORER_URL;
export const isActiveTestnet = activeChainId !== RISE_MAINNET_CHAIN_ID;
export const activeDeploymentBlock = BigInt(env.VITE_DEPLOYMENT_BLOCK);

export const activeChain = defineChain({
  id: activeChainId,
  name:
    activeChainId === RISE_MAINNET_CHAIN_ID
      ? "RISE Mainnet"
      : activeChainId === 31_337
        ? "Local Anvil"
        : "RISE Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: {
    default: { name: "RISE Explorer", url: activeExplorerUrl },
  },
  testnet: isActiveTestnet,
});

// Public RPCs drop log queries under load; viem retries with exponential backoff.
const transports = {
  [activeChain.id]: http(rpcUrl, { retryCount: 5, retryDelay: 500 }),
};
export const wagmiConfig = createConfig({
  chains: [activeChain],
  transports,
  ssr: true,
  multiInjectedProviderDiscovery: false,
});

const configuredLaunchpad = env.VITE_LAUNCHPAD_ADDRESS.trim();
const configuredFeeMode = env.VITE_LAUNCH_FEE_MODE || "fixed";
if (configuredFeeMode !== "fixed" && configuredFeeMode !== "oracle")
  throw new Error("VITE_LAUNCH_FEE_MODE must be fixed or oracle.");
export const activeLaunchFeeMode = configuredFeeMode;
export const launchpadAddress: Address | null = isAddress(configuredLaunchpad)
  ? getAddress(configuredLaunchpad)
  : null;
const configuredSwapAdapter =
  typeof env.VITE_ICARUS_SWAP_ADAPTER === "string"
    ? env.VITE_ICARUS_SWAP_ADAPTER.trim()
    : "";
const configuredSwapAdapterCodeHash =
  typeof env.VITE_ICARUS_SWAP_ADAPTER_CODE_HASH === "string"
    ? env.VITE_ICARUS_SWAP_ADAPTER_CODE_HASH.trim()
    : "";
const validSwapAdapterConfig =
  isAddress(configuredSwapAdapter) &&
  /^0x[0-9a-fA-F]{64}$/.test(configuredSwapAdapterCodeHash);
export const activeSwapAdapterAddress: Address | null = validSwapAdapterConfig
  ? getAddress(configuredSwapAdapter)
  : null;
export const activeSwapAdapterCodeHash: Hex | null = validSwapAdapterConfig
  ? (configuredSwapAdapterCodeHash.toLowerCase() as Hex)
  : null;
export const curveballSdk = launchpadAddress
  ? createCurveballSdk(
      wagmiConfig,
      defineCurveballDeployment({
        chainId: activeChainId,
        launchpad: launchpadAddress,
        feeMode: activeLaunchFeeMode,
        ...(activeSwapAdapterAddress
          ? {
              swapAdapter: activeSwapAdapterAddress,
              swapAdapterCodeHash: activeSwapAdapterCodeHash!,
            }
          : {}),
        slippageBps: 300,
        deadlineSeconds: 300,
      }),
    )
  : null;

const legacyAddress = String(env.VITE_LEGACY_LAUNCHPAD_ADDRESS || "").trim();
const legacyBlock = String(env.VITE_LEGACY_DEPLOYMENT_BLOCK || "").trim();
const legacyAdapter = String(env.VITE_LEGACY_ICARUS_SWAP_ADAPTER || "").trim();
const legacyAdapterHash = String(env.VITE_LEGACY_ICARUS_SWAP_ADAPTER_CODE_HASH || "").trim();
if (Boolean(legacyAddress) !== Boolean(legacyBlock) || (legacyAdapter && !legacyAddress))
  throw new Error("Legacy launchpad address, block, and adapter must be configured together.");
if (legacyAddress && (!isAddress(legacyAddress) || !/^\d+$/.test(legacyBlock)))
  throw new Error("Legacy launchpad address and deployment block must be valid.");
if (Boolean(legacyAdapter) !== Boolean(legacyAdapterHash) ||
    (legacyAdapter && (!isAddress(legacyAdapter) || !/^0x[0-9a-fA-F]{64}$/.test(legacyAdapterHash))))
  throw new Error("Legacy swap adapter address and code hash must be valid.");
export const legacyLaunchpadAddress: Address | null = legacyAddress ? getAddress(legacyAddress) : null;
if (legacyLaunchpadAddress?.toLowerCase() === launchpadAddress?.toLowerCase())
  throw new Error("Legacy and active launchpads must be distinct.");
export const legacyDeploymentBlock = legacyBlock ? BigInt(legacyBlock) : null;
export const legacySwapAdapterAddress: Address | null = legacyAdapter ? getAddress(legacyAdapter) : null;
export const legacyCurveballSdk = legacyLaunchpadAddress
  ? createCurveballSdk(wagmiConfig, defineCurveballDeployment({
      chainId: activeChainId,
      launchpad: legacyLaunchpadAddress,
      feeMode: "fixed",
      ...(legacySwapAdapterAddress ? {
        swapAdapter: legacySwapAdapterAddress,
        swapAdapterCodeHash: legacyAdapterHash.toLowerCase(),
      } : {}),
      slippageBps: 300,
      deadlineSeconds: 300,
    }))
  : null;
export const launchpadDeployments = [
  ...(launchpadAddress ? [{ address: launchpadAddress, block: activeDeploymentBlock }] : []),
  ...(legacyLaunchpadAddress && legacyDeploymentBlock !== null
    ? [{ address: legacyLaunchpadAddress, block: legacyDeploymentBlock }] : []),
];

export function requireCurveballSdk() {
  if (!curveballSdk) throw new Error("Curveball deployment is not configured.");
  return curveballSdk;
}
