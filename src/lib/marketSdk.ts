import { type Address } from "viem";
import { factoryForToken } from "./marketFactories";
import { requireCurveballSdk } from "./web3";

export function sdkForMarket(factory?: Address | null) {
  factoryForToken(factory);
  return requireCurveballSdk();
}
