import { getAddress, type Address } from "viem";
import legacyV2 from "../../deployments/11155931/curveball-v2.json";
import currentV2 from "../../deployments/11155931/curveball-v2-permissionless.json";
import { RISE_TESTNET_CHAIN_ID } from "../sdk/curveballSdk";
import { activeChainId, activeContractVersion, activeDeploymentBlock, launchpadAddress } from "./web3";

export type MarketFactory = { address: Address; fromBlock: bigint };
const LEGACY_FIRST_LAUNCH_BLOCK = 56_102_377n;

export function marketFactories(): MarketFactory[] {
  if (!launchpadAddress) return [];
  const active = { address: launchpadAddress, fromBlock: activeDeploymentBlock };
  if (activeContractVersion !== "v2" || activeChainId !== RISE_TESTNET_CHAIN_ID ||
      launchpadAddress.toLowerCase() !== currentV2.factory.toLowerCase()) return [active];
  return [{ address: getAddress(legacyV2.factory), fromBlock: LEGACY_FIRST_LAUNCH_BLOCK }, active];
}

export function factoryForToken(factory?: Address | null): Address {
  if (!launchpadAddress) throw new Error("Curveball deployment is not configured.");
  if (!factory) return launchpadAddress;
  const match = marketFactories().find((item) => item.address.toLowerCase() === factory.toLowerCase());
  if (!match) throw new Error("This market belongs to an unsupported factory.");
  return match.address;
}
