import { type Address } from "viem";
import { defineCurveballDeployment } from "../sdk/curveballSdk";
import { createV2Sdk } from "../sdk/v2Sdk";
import { factoryForToken } from "./marketFactories";
import { activeChainId, activeContractVersion, launchpadAddress, requireCurveballSdk, wagmiConfig } from "./web3";

const previousSdks = new Map<Address, ReturnType<typeof createV2Sdk>>();

export function sdkForMarket(factory?: Address | null) {
  const address = factoryForToken(factory);
  if (address === launchpadAddress) return requireCurveballSdk();
  if (activeContractVersion !== "v2") throw new Error("Unsupported market version.");
  let sdk = previousSdks.get(address);
  if (!sdk) {
    sdk = createV2Sdk(wagmiConfig, defineCurveballDeployment({ chainId: activeChainId, launchpad: address, slippageBps: 300, deadlineSeconds: 300 }));
    previousSdks.set(address, sdk);
  }
  return sdk;
}
