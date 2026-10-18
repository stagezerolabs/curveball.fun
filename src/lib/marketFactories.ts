import { type Address } from "viem";
import { launchpadAddress, requireCurveballSdk } from "./web3";

export function factoryForToken(factory?: Address | null): Address {
  if (!launchpadAddress) throw new Error("Curveball deployment is not configured.");
  if (!factory || factory.toLowerCase() === launchpadAddress.toLowerCase()) return launchpadAddress;
  throw new Error("This market does not belong to the configured launchpad.");
}

export function sdkForMarket(factory?: Address | null) {
  factoryForToken(factory);
  return requireCurveballSdk();
}
