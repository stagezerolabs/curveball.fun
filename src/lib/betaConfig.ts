import { getAddress, type Address } from "viem";
import recorded from "../../deployments/11155931/token-beta.json";
import { RISE_TESTNET_CHAIN_ID } from "../sdk/curveballSdk";

export type BetaDeployment = Readonly<{
  factory: Address;
  musdc: Address;
  mweth: Address;
  venue: Address;
  adapter: Address;
  deploymentBlock: bigint;
}>;

export function resolveBetaDeployment(env: Record<string, string | boolean | undefined>): BetaDeployment | null {
  if (env.VITE_BETA_ENABLED === "false") return null;
  if (Number(env.VITE_CHAIN_ID || RISE_TESTNET_CHAIN_ID) !== RISE_TESTNET_CHAIN_ID) return null;
  if (recorded.chainId !== RISE_TESTNET_CHAIN_ID) throw new Error("Beta deployment chain mismatch.");
  return {
    factory: getAddress(recorded.factory), musdc: getAddress(recorded.musdc), mweth: getAddress(recorded.mweth),
    venue: getAddress(recorded.venue), adapter: getAddress(recorded.adapter),
    deploymentBlock: BigInt(recorded.deploymentBlock),
  };
}

export const betaDeployment = resolveBetaDeployment(import.meta.env);
