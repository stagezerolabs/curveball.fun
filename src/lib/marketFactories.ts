import { type Address } from "viem";
import { activeChainId, launchpadAddress, legacyFactories, requireCurveballSdk, wagmiConfig } from "./web3";
import { createV2Sdk } from "../sdk/v2Sdk";
import { defineCurveballDeployment } from "../sdk/curveballSdk";

const legacySdks = new Map<string, ReturnType<typeof createV2Sdk>>();

export function factoryForToken(factory?: Address | null): Address {
  if (!launchpadAddress) throw new Error("Curveball deployment is not configured.");
  if (!factory || factory.toLowerCase() === launchpadAddress.toLowerCase()) return launchpadAddress;
  const legacy = legacyFactories.find((entry) => entry.address.toLowerCase() === factory.toLowerCase());
  if (!legacy) throw new Error("This market belongs to an unsupported factory.");
  return legacy.address;
}

export function sdkForMarket(factory?: Address | null) {
  const address = factoryForToken(factory);
  if (address.toLowerCase() === launchpadAddress?.toLowerCase()) return requireCurveballSdk();
  const key = address.toLowerCase();
  let sdk = legacySdks.get(key);
  if (!sdk) {
    sdk = createV2Sdk(wagmiConfig, defineCurveballDeployment({ chainId: activeChainId, launchpad: address }));
    legacySdks.set(key, sdk);
  }
  return sdk;
}
