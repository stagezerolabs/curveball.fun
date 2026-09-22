import {
  RISE_TESTNET_CHAIN_ID,
  RISE_TESTNET_RPC_URL,
} from "../sdk/curveballSdk";

type ClientEnv = Record<string, string | boolean | undefined>;

export function resolveRiseTestnetRpcUrl(env: ClientEnv): string {
  const configuredChainId = Number(env.VITE_CHAIN_ID);
  if (configuredChainId !== RISE_TESTNET_CHAIN_ID) {
    return RISE_TESTNET_RPC_URL;
  }
  const configuredRpc =
    typeof env.VITE_RPC_URL === "string" ? env.VITE_RPC_URL.trim() : "";
  return configuredRpc || RISE_TESTNET_RPC_URL;
}
