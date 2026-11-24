import { type Address } from "viem";
import { curveballSdk, launchpadAddress, legacyCurveballSdk, legacyLaunchpadAddress, activeSwapAdapterAddress, legacySwapAdapterAddress } from "./web3";

export function factoryForToken(factory?: Address | null): Address {
  if (!launchpadAddress)
    throw new Error("Curveball deployment is not configured.");
  if (!factory || factory.toLowerCase() === launchpadAddress.toLowerCase())
    return launchpadAddress;
  if (legacyLaunchpadAddress && factory.toLowerCase() === legacyLaunchpadAddress.toLowerCase())
    return legacyLaunchpadAddress;
  throw new Error("This market does not belong to the configured launchpad.");
}

export function sdkForMarket(factory?: Address | null) {
  const address = factoryForToken(factory);
  const sdk = address.toLowerCase() === launchpadAddress?.toLowerCase()
    ? curveballSdk : legacyCurveballSdk;
  if (!sdk) throw new Error("Curveball deployment is not configured.");
  return sdk;
}

export function swapAdapterForMarket(factory?: Address | null) {
  const address = factoryForToken(factory);
  return address.toLowerCase() === launchpadAddress?.toLowerCase()
    ? activeSwapAdapterAddress : legacySwapAdapterAddress;
}
