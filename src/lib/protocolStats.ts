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

export async function getCreatorPayouts(
  client: StatsClient,
  factory: Address,
  tokens: Pick<Token, "address" | "creator">[],
  fromBlock: bigint,
): Promise<{ amount: bigint; decimals: number }> {
  const [escrow, quote, latest] = await Promise.all([
    client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "escrow" }) as Promise<Address>,
    client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "quote" }) as Promise<Address>,
    client.getBlockNumber(),
  ]);
  const decimals = Number(await client.readContract({ address: quote, abi: erc20Abi, functionName: "decimals" }));
  const creators = new Map(tokens.map(({ address, creator }) => [getAddress(address), getAddress(creator)]));
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = fromBlock; start <= latest; start += QUERY_BLOCKS) {
    ranges.push({
      fromBlock: start,
      toBlock: start + QUERY_BLOCKS - 1n < latest ? start + QUERY_BLOCKS - 1n : latest,
    });
  }
  let nextRange = 0;
  const totals = await Promise.all(Array.from({ length: Math.min(6, ranges.length) }, async () => {
    let subtotal = 0n;
    while (nextRange < ranges.length) {
      const range = ranges[nextRange++];
      const claims = await client.getContractEvents({
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
