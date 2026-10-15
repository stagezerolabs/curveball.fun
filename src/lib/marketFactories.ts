import { type Address } from "viem";
import { activeDeploymentBlock, launchpadAddress } from "./web3";

export type MarketFactory = { address: Address; fromBlock: bigint };
export function marketFactories(): MarketFactory[] {
  if (!launchpadAddress) return [];
  return [{ address: launchpadAddress, fromBlock: activeDeploymentBlock }];
}

export function factoryForToken(factory?: Address | null): Address {
  if (!launchpadAddress) throw new Error("Curveball deployment is not configured.");
  if (!factory) return launchpadAddress;
  const match = marketFactories().find((item) => item.address.toLowerCase() === factory.toLowerCase());
  if (!match) throw new Error("This market belongs to an unsupported factory.");
  return match.address;
}
