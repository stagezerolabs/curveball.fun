import { getAddress, zeroAddress, type Address } from "viem";
import { v2CurveAbi, v2FactoryAbi } from "./sdk/v2Contracts";

export type V2MarketClient = { readContract(parameters: { address: Address; abi: unknown; functionName: string; args?: readonly unknown[] }): Promise<unknown> };

export async function readV2Market(client: V2MarketClient, factory: Address, token: Address) {
  const market = await client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "market", args: [token] }) as readonly [Address, Address, number, number, number, number, Address];
  const [curve, creator, feeBps, creatorShareBps, buybackShareBps, creatorTaxBps, treasury] = market;
  if (curve === zeroAddress) throw new Error("Unknown Curveball market.");
  const read = (functionName: string) => client.readContract({ address: curve, abi: v2CurveAbi, functionName });
  const [virtualToken, virtualQuote, realQuote, sold, ready, graduated, pool] = await Promise.all([
    read("virtualToken"), read("virtualQuote"), read("realQuote"), read("sold"),
    read("ready"), read("graduated"), read("pool"),
  ]) as [bigint, bigint, bigint, bigint, boolean, boolean, Address];
  return {
    curve: getAddress(curve), creator: getAddress(creator), feeBps: Number(feeBps),
    creatorShareBps: Number(creatorShareBps), buybackShareBps: Number(buybackShareBps),
    creatorTaxBps: Number(creatorTaxBps), treasury: getAddress(treasury),
    virtualToken, virtualQuote, realQuote, sold, ready, graduated,
    pool: pool === zeroAddress ? null : getAddress(pool),
  };
}
