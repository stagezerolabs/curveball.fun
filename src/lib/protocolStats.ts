import { getAddress, type Address } from "viem";
import { erc20Abi } from "../sdk/contracts";
import { v2EscrowAbi, v2FactoryAbi } from "../sdk/v2Contracts";
import type { Token } from "../types";

type Claim = { args?: { launch?: Address; asset?: Address; recipient?: Address; amount?: bigint } };
type StatsClient = {
  getBlockNumber(): Promise<bigint>;
  readContract(parameters: object): Promise<unknown>;
  getContractEvents(parameters: object): Promise<readonly Claim[]>;
};

const QUERY_BLOCKS = 5_000n;
const QUERY_CONCURRENCY = 2;

async function readClaims(client: StatsClient, parameters: object): Promise<readonly Claim[]> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await client.getContractEvents(parameters);
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 4_000)));
    }
  }
  throw lastError;
}

export async function getCreatorPayouts(
  client: StatsClient,
  factory: Address,
  tokens: (Pick<Token, "address" | "creator"> & Partial<Pick<Token, "createdBlock">>)[],
  fromBlock: bigint,
): Promise<{ amount: bigint; decimals: number }> {
  const [escrow, quote, latest] = await Promise.all([
    client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "escrow" }) as Promise<Address>,
    client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "quote" }) as Promise<Address>,
    client.getBlockNumber(),
  ]);
  const decimals = Number(await client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }));
  if (tokens.length === 0) return { amount: 0n, decimals };
  const creators = new Map(tokens.map(({ address, creator }) => [getAddress(address), getAddress(creator)]));
  const launchBlocks = tokens.map(({ createdBlock }) => createdBlock && /^\d+$/.test(createdBlock) ? BigInt(createdBlock) : null);
  const earliestLaunchBlock = launchBlocks.every((block) => block !== null)
    ? launchBlocks.reduce<bigint>((earliest, block) => block! < earliest ? block! : earliest, latest)
    : null;
  const firstClaimBlock = earliestLaunchBlock !== null && earliestLaunchBlock > fromBlock ? earliestLaunchBlock : fromBlock;
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = firstClaimBlock; start <= latest; start += QUERY_BLOCKS) {
    ranges.push({
      fromBlock: start,
      toBlock: start + QUERY_BLOCKS - 1n < latest ? start + QUERY_BLOCKS - 1n : latest,
    });
  }
  let nextRange = 0;
  const totals = await Promise.all(Array.from({ length: Math.min(QUERY_CONCURRENCY, ranges.length) }, async () => {
    let subtotal = 0n;
    while (nextRange < ranges.length) {
      const range = ranges[nextRange++];
      const claims = await readClaims(client, {
        address: escrow,
        abi: v2EscrowAbi,
        eventName: "FeeClaimed",
        args: { asset: quote },
        ...range,
        strict: true,
      });
      for (const { args } of claims) {
        if (!args?.launch || !args.recipient || !args.asset || args.amount === undefined) continue;
        if (getAddress(args.asset) !== getAddress(quote)) continue;
        if (creators.get(getAddress(args.launch)) === getAddress(args.recipient)) subtotal += args.amount;
      }
    }
    return subtotal;
  }));
  return { amount: totals.reduce((sum, value) => sum + value, 0n), decimals };
}
