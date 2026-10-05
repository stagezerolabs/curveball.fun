import {
  RISE_MAINNET_CHAIN_ID,
  RISE_MAINNET_RPC_URL,
  RISE_TESTNET_CHAIN_ID,
  RISE_TESTNET_RPC_URL,
} from "../sdk/curveballSdk";

type ClientEnv = Record<string, string | boolean | undefined>;

export function resolveContractVersion(env: ClientEnv): "v1" | "v2" {
  const version = env.VITE_CONTRACT_VERSION || "v1";
  if (version !== "v1" && version !== "v2") throw new Error("VITE_CONTRACT_VERSION must be v1 or v2.");
  if (version === "v2") {
    if (!env.VITE_LAUNCHPAD_ADDRESS) throw new Error("VITE_LAUNCHPAD_ADDRESS is required for V2.");
    if (!env.VITE_DEPLOYMENT_BLOCK) throw new Error("VITE_DEPLOYMENT_BLOCK is required for V2.");
  }
  return version;
}

export function resolveRiseTestnetRpcUrl(env: ClientEnv): string {
  const configuredChainId = Number(env.VITE_CHAIN_ID || RISE_TESTNET_CHAIN_ID);
  if (![RISE_TESTNET_CHAIN_ID, RISE_MAINNET_CHAIN_ID, 31_337].includes(configuredChainId)) {
    throw new Error("VITE_CHAIN_ID must select RISE Testnet, RISE mainnet, or local Anvil.");
  }
  const configuredRpc =
    typeof env.VITE_RPC_URL === "string" ? env.VITE_RPC_URL.trim() : "";
  if (configuredRpc && env.VITE_CHAIN_ID) return configuredRpc;
  if (configuredChainId === RISE_MAINNET_CHAIN_ID) return RISE_MAINNET_RPC_URL;
  if (configuredChainId === 31_337) return "http://127.0.0.1:8545";
  return RISE_TESTNET_RPC_URL;
}
