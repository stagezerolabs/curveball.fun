import { describe, expect, test } from "bun:test";
import { getCreatorEarnings } from "./protocolStats";
import type { Address } from "viem";

const token: Address = "0x2222222222222222222222222222222222222222";
const quote: Address = "0x3333333333333333333333333333333333333333";
const escrow: Address = "0x4444444444444444444444444444444444444444";

describe("creator earnings", () => {
  test("sums the WETH credited to the listed launches' creators", async () => {
    const queries: object[] = [];
    const client = {
      getBlockNumber: async () => 11n,
      readContract: async ({ functionName }: { functionName: string }) => functionName === "escrow" ? escrow : functionName === "quoteToken" ? quote : 6,
      getContractEvents: async (query: object) => {
        queries.push(query);
        return [
          { args: { token, asset: quote, creatorAmount: 1_500_000n } },
          { args: { token, asset: quote, creatorAmount: 500_000n } },
          { args: { token: escrow, asset: quote, creatorAmount: 9_000_000n } },
          { args: { token, asset: token, creatorAmount: 9_000_000n } },
        ];
      },
    };
    const result = await getCreatorEarnings(client, escrow, [{ address: token }], 10n);
    expect(result).toEqual({ amount: 2_000_000n, decimals: 6 });
    expect(queries).toHaveLength(1);
  });

  test("does not scan claim logs when there are no launches", async () => {
    const queries: { fromBlock: bigint; toBlock: bigint }[] = [];
    const client = {
      getBlockNumber: async () => 5_010n,
      readContract: async ({ functionName }: { functionName: string }) => functionName === "escrow" ? escrow : functionName === "quoteToken" ? quote : 18,
      getContractEvents: async (query: object) => {
        queries.push(query as { fromBlock: bigint; toBlock: bigint });
        return [];
      },
    };
    expect(await getCreatorEarnings(client, escrow, [], 10n)).toEqual({ amount: 0n, decimals: 18 });
    expect(queries).toEqual([]);
  });

  test("starts claim scans at the first known launch block", async () => {
    const queries: { fromBlock: bigint; toBlock: bigint }[] = [];
    const client = {
      getBlockNumber: async () => 10_000n,
      readContract: async ({ functionName }: { functionName: string }) => functionName === "escrow" ? escrow : functionName === "quoteToken" ? quote : 18,
      getContractEvents: async (query: object) => {
        queries.push(query as { fromBlock: bigint; toBlock: bigint });
        return [];
      },
    };
    await getCreatorEarnings(client, escrow, [{ address: token, createdBlock: "8000" }], 10n);
    expect(queries.map(({ fromBlock }) => fromBlock)).toEqual([8_000n]);
  });
});
