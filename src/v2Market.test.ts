import { expect, test } from "bun:test";
import { getAddress, zeroAddress } from "viem";
import { readV2Market } from "./v2Market";

test("V2 market read uses registered curve reserves and reports ready phase", async () => {
  const factory = getAddress("0x1111111111111111111111111111111111111111");
  const token = getAddress("0x2222222222222222222222222222222222222222");
  const curve = getAddress("0x3333333333333333333333333333333333333333");
  const calls: { address: string; functionName: string }[] = [];
  const client = {
    readContract: async (p: { address: string; functionName: string }) => {
      calls.push(p);
      const values: Record<string, unknown> = {
        market: [curve, factory, 50, 5000, 2500, 25, factory],
        virtualToken: 200_000n * 10n ** 18n,
        virtualQuote: 50n * 10n ** 18n,
        realQuote: 40n * 10n ** 18n,
        sold: 800_000n * 10n ** 18n,
        ready: true,
        graduated: false,
        pool: zeroAddress,
      };
      return values[p.functionName];
    },
  };
  expect(await readV2Market(client, factory, token)).toMatchObject({
    curve, creatorTaxBps: 25, feeBps: 50, sold: 800_000n * 10n ** 18n,
    ready: true, graduated: false, pool: null,
  });
  expect(calls.filter((p) => p.functionName !== "market").every((p) => p.address === curve)).toBe(true);
});
