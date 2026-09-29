import {
  RISE_MAINNET_CHAIN_ID,
  RISE_MAINNET_RPC_URL,
  RISE_TESTNET_CHAIN_ID,
  RISE_TESTNET_RPC_URL,
} from "../sdk/curveballSdk";

type ClientEnv = Record<string, string | boolean | undefined>;

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
