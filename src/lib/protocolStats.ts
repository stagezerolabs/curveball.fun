import { getAddress, type Address } from "viem";
import { curveFeeEscrowAbi, curveLaunchpadAbi, erc20Abi } from "../sdk/contracts";
import type { Token } from "../types";

type Accrual = { args?: { token?: Address; asset?: Address; creatorAmount?: bigint } };
type StatsClient = {
  getBlockNumber(): Promise<bigint>;
  readContract(parameters: object): Promise<unknown>;
  getContractEvents(parameters: object): Promise<readonly Accrual[]>;
};

const QUERY_BLOCKS = 5_000n;
const QUERY_CONCURRENCY = 2;

async function readAccruals(client: StatsClient, parameters: object): Promise<readonly Accrual[]> {
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

/**
 * WETH credited to creators across the listed launches: curve fees, creator tax and pool fees.
 * Read from the escrow's per-launch FeeAccrued events; claims can't be attributed to a launch,
 * because one claim pays a creator everything it is owed across all of its launches.
 */
export async function getCreatorEarnings(
  client: StatsClient,
  factory: Address,
  tokens: (Pick<Token, "address"> & Partial<Pick<Token, "createdBlock">>)[],
  fromBlock: bigint,
): Promise<{ amount: bigint; decimals: number }> {
  const [escrow, quote, latest] = await Promise.all([
    client.readContract({ address: factory, abi: curveLaunchpadAbi, functionName: "escrow" }) as Promise<Address>,
    client.readContract({ address: factory, abi: curveLaunchpadAbi, functionName: "quoteToken" }) as Promise<Address>,
    client.getBlockNumber(),
  ]);
  const decimals = Number(await client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }));
  if (tokens.length === 0) return { amount: 0n, decimals };
  const launches = new Set(tokens.map(({ address }) => getAddress(address)));
  const launchBlocks = tokens.map(({ createdBlock }) => createdBlock && /^\d+$/.test(createdBlock) ? BigInt(createdBlock) : null);
  const earliestLaunchBlock = launchBlocks.every((block) => block !== null)
    ? launchBlocks.reduce<bigint>((earliest, block) => block! < earliest ? block! : earliest, latest)
    : null;
  const firstBlock = earliestLaunchBlock !== null && earliestLaunchBlock > fromBlock ? earliestLaunchBlock : fromBlock;
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = firstBlock; start <= latest; start += QUERY_BLOCKS) {
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
      const accruals = await readAccruals(client, {
        address: escrow,
        abi: curveFeeEscrowAbi,
        eventName: "FeeAccrued",
        args: { asset: quote },
        ...range,
        strict: true,
      });
      for (const { args } of accruals) {
        if (!args?.token || !args.asset || args.creatorAmount === undefined) continue;
        if (getAddress(args.asset) !== getAddress(quote)) continue;
        if (launches.has(getAddress(args.token))) subtotal += args.creatorAmount;
      }
    }
    return subtotal;
  }));
  return { amount: totals.reduce((sum, value) => sum + value, 0n), decimals };
}
