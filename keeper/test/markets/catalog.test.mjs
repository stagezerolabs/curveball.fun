import { test } from "node:test";
import assert from "node:assert/strict";
import { createMarketCatalog } from "../../src/features/markets/catalog.mjs";

const launchpad = "0x0000000000000000000000000000000000000004";
const token = "0x0000000000000000000000000000000000000001";

test("discovery scans bounded ranges and advances its cursor", async () => {
  const ranges = [];
  const publicClient = {
    getBlockNumber: async () => 10_002n,
    getContractEvents: async ({ fromBlock, toBlock }) => {
      ranges.push([fromBlock, toBlock]);
      return [{ args: { token } }];
    },
  };
  const catalog = createMarketCatalog({
    publicClient,
    launchpad,
    deploymentBlock: 0n,
  });

  await catalog.discoverLaunches();
  assert.deepEqual(ranges, [
    [0n, 4_999n],
    [5_000n, 9_999n],
    [10_000n, 10_002n],
  ]);
  assert.deepEqual([...catalog.markets.values()], [token]);

  await catalog.discoverLaunches();
  assert.equal(ranges.length, 3);
});

test("discovery retries a failed range without advancing the cursor", async () => {
  const ranges = [];
  let fail = true;
  const publicClient = {
    getBlockNumber: async () => 5_000n,
    getContractEvents: async ({ fromBlock }) => {
      ranges.push(fromBlock);
      if (fromBlock === 5_000n && fail) {
        fail = false;
        throw new Error("RPC unavailable");
      }
      return [{ args: { token } }];
    },
  };
  const catalog = createMarketCatalog({
    publicClient,
    launchpad,
    deploymentBlock: 0n,
  });

  await assert.rejects(catalog.discoverLaunches(), /RPC unavailable/);
  await catalog.discoverLaunches();
  assert.deepEqual(ranges, [0n, 5_000n, 0n, 5_000n]);
  assert.deepEqual([...catalog.markets.values()], [token]);
});
