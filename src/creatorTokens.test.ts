import { describe, expect, test } from "bun:test";
import { getAddress, zeroAddress } from "viem";
import {
  discoverAllTokens,
  discoverCreatorTokens,
  discoverToken,
} from "./creatorTokens";

const creator = getAddress("0x18B99327e596d422a242F60b51979bF9d76841c2");
const token = getAddress("0x1111111111111111111111111111111111111111");

describe("creator token discovery", () => {
  test("turns indexed TokenCreated logs into dashboard tokens", async () => {
    const client = {
      getContractEvents: async () => [
        {
          args: { token, creator, name: "LONGNICO", symbol: "NICO", uri: "" },
          blockNumber: 55_002_180n,
        },
      ],
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "curveSupply"
          ? 800_000n * 10n ** 18n
          : [
              creator,
              700_000n * 10n ** 18n,
              11n * 10n ** 18n,
              1n * 10n ** 18n,
              100_000n * 10n ** 18n,
              false,
              false,
              zeroAddress,
            ],
      getBlock: async () => ({ timestamp: 1_790_000_000n }),
    };

    const result = await discoverCreatorTokens(client, creator);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      address: token,
      creator,
      name: "LONGNICO",
      symbol: "NICO",
      graduated: false,
      progress: 12.5,
      pool: null,
    });
    expect(result[0].createdAt).toBe(
      new Date(1_790_000_000_000).toISOString(),
    );
  });

  test("returns an empty dashboard for a wallet with no launches", async () => {
    const client = {
      getContractEvents: async () => [],
      readContract: async () => 800_000n * 10n ** 18n,
      getBlock: async () => ({ timestamp: 0n }),
    };

    expect(await discoverCreatorTokens(client, creator)).toEqual([]);
  });

  test("loads a market directly by token address when the indexer has no row", async () => {
    let eventFilter: object | undefined;
    const client = {
      getContractEvents: async (parameters: object) => {
        eventFilter = parameters;
        return [
          {
            args: { token, creator, name: "LONGNICO", symbol: "NICO", uri: "" },
            blockNumber: 55_002_180n,
          },
        ];
      },
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "curveSupply"
          ? 800_000n * 10n ** 18n
          : [creator, 0n, 0n, 0n, 0n, false, false, zeroAddress],
      getBlock: async () => ({ timestamp: 1_790_000_000n }),
    };

    expect(await discoverToken(client, token)).toMatchObject({
      address: token,
      name: "LONGNICO",
      symbol: "NICO",
    });
    expect(eventFilter).toMatchObject({ args: { token } });
  });

  test("discovers every launch for the public market feed", async () => {
    let eventFilter: Record<string, unknown> | undefined;
    const client = {
      getContractEvents: async (parameters: Record<string, unknown>) => {
        eventFilter = parameters;
        return [
          {
            args: { token, creator, name: "LONGNICO", symbol: "NICO", uri: "" },
            blockNumber: 55_002_180n,
          },
        ];
      },
      readContract: async ({ functionName }: { functionName: string }) =>
        functionName === "curveSupply"
          ? 800_000n * 10n ** 18n
          : [creator, 0n, 0n, 0n, 0n, false, false, zeroAddress],
      getBlock: async () => ({ timestamp: 1_790_000_000n }),
    };

    expect(await discoverAllTokens(client)).toHaveLength(1);
    expect(eventFilter).not.toHaveProperty("args");
  });

  test("batches event discovery within the public RPC block-range limit", async () => {
    const eventQueries: Record<string, unknown>[] = [];
    const client = {
      getBlockNumber: async () => 55_012_178n,
      getContractEvents: async (parameters: Record<string, unknown>) => {
        eventQueries.push(parameters);
        return [];
      },
      readContract: async () => 800_000n * 10n ** 18n,
      getBlock: async () => ({ timestamp: 0n }),
    };

    expect(await discoverAllTokens(client)).toEqual([]);
    expect(eventQueries).toEqual([
      expect.objectContaining({ fromBlock: 55_002_177n, toBlock: 55_007_176n }),
      expect.objectContaining({ fromBlock: 55_007_177n, toBlock: 55_012_176n }),
      expect.objectContaining({ fromBlock: 55_012_177n, toBlock: 55_012_178n }),
    ]);
  });
});
