import { parseAbiItem, zeroAddress, type Address, type PublicClient } from "viem";
import { buildBlockRanges } from "./marketChart";

export type HolderBalance = { address: Address; balance: bigint };
type TransferClient = Pick<PublicClient, "getContractEvents">;

const QUERY_SPAN = 5_000n;
const transferEvent = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");

/** Reconstruct direct balances from the token's Transfer events at a fixed block. */
export async function readHolderSnapshot(
  client: TransferClient,
  token: Address,
  fromBlock: bigint,
  snapshotBlock: bigint,
  excluded: readonly Address[],
): Promise<HolderBalance[]> {
  const ranges = buildBlockRanges(fromBlock, snapshotBlock, QUERY_SPAN);
  const balances = new Map<string, HolderBalance>();
  const excludedSet = new Set(excluded.map((address) => address.toLowerCase()));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, ranges.length) }, async () => {
    while (next < ranges.length) {
      const range = ranges[next++];
      const logs = await client.getContractEvents({
        address: token,
        abi: [transferEvent],
        eventName: "Transfer",
        strict: true,
        ...range,
      });
      for (const { args } of logs) {
        if (!args.from || !args.to || args.value === undefined) continue;
        if (args.from !== zeroAddress) {
          const key = args.from.toLowerCase();
          const previous = balances.get(key)?.balance ?? 0n;
          balances.set(key, { address: args.from, balance: previous - args.value });
        }
        if (args.to !== zeroAddress) {
          const key = args.to.toLowerCase();
          const previous = balances.get(key)?.balance ?? 0n;
          balances.set(key, { address: args.to, balance: previous + args.value });
        }
      }
    }
  }));
  return [...balances.entries()]
    .filter(([key, holder]) => !excludedSet.has(key) && holder.balance > 0n)
    .map(([, holder]) => holder)
    .sort((a, b) => a.balance === b.balance ? a.address.localeCompare(b.address) : a.balance > b.balance ? -1 : 1);
}
