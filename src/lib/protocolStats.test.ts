import { describe, expect, test } from "bun:test";
import { getCreatorPayouts } from "./protocolStats";
import type { Address } from "viem";

const creator: Address = "0x1111111111111111111111111111111111111111";
const token: Address = "0x2222222222222222222222222222222222222222";
const quote: Address = "0x3333333333333333333333333333333333333333";
const escrow: Address = "0x4444444444444444444444444444444444444444";

describe("creator payouts", () => {
  test("counts only claimed quote assets sent to the launch creator", async () => {
    const queries: object[] = [];
    const client = {
      getBlockNumber: async () => 11n,
      readContract: async ({ functionName }: { functionName: string }) => functionName === "escrow" ? escrow : functionName === "quote" ? quote : 6,
      getContractEvents: async (query: object) => {
        queries.push(query);
        return [
          { args: { launch: token, asset: quote, recipient: creator, amount: 2_000_000n } },
          { args: { launch: token, asset: quote, recipient: escrow, amount: 9_000_000n } },
          { args: { launch: token, asset: escrow, recipient: creator, amount: 9_000_000n } },
        ];
      },
    };
    const result = await getCreatorPayouts(client, escrow, [{ address: token, creator }], 10n);
    expect(result).toEqual({ amount: 2_000_000n, decimals: 6 });
    expect(queries).toHaveLength(1);
  });

  test("does not scan claim logs when there are no launches", async () => {
    const queries: { fromBlock: bigint; toBlock: bigint }[] = [];
    const client = {
      getBlockNumber: async () => 5_010n,
      readContract: async ({ functionName }: { functionName: string }) => functionName === "escrow" ? escrow : functionName === "quote" ? quote : 18,
      getContractEvents: async (query: object) => {
        queries.push(query as { fromBlock: bigint; toBlock: bigint });
        return [];
      },
    };
    expect(await getCreatorPayouts(client, escrow, [], 10n)).toEqual({ amount: 0n, decimals: 18 });
    expect(queries).toEqual([]);
  });

  test("starts claim scans at the first known launch block", async () => {
    const queries: { fromBlock: bigint; toBlock: bigint }[] = [];
    const client = {
      getBlockNumber: async () => 10_000n,
      readContract: async ({ functionName }: { functionName: string }) => functionName === "escrow" ? escrow : functionName === "quote" ? quote : 18,
      getContractEvents: async (query: object) => {
        queries.push(query as { fromBlock: bigint; toBlock: bigint });
        return [];
      },
    };
    await getCreatorPayouts(client, escrow, [{ address: token, creator, createdBlock: "8000" }], 10n);
    expect(queries.map(({ fromBlock }) => fromBlock)).toEqual([8_000n]);
  });
});
