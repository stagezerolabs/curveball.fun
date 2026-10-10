import { expect, test } from "bun:test";
import { discoverAllTokens, type CreatorTokenClient } from "./creatorTokens";

test("the recorded testnet factory skips blocks before its first launch", async () => {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    getBlockNumber: async () => 56_102_377n,
    getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push({ fromBlock, toBlock });
      return [];
    },
  } as unknown as CreatorTokenClient;

  expect(await discoverAllTokens(client, "v2")).toEqual([]);
  expect(ranges).toEqual([{ fromBlock: 56_102_377n, toBlock: 56_102_377n }]);
});
