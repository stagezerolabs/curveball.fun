import { expect, test } from "bun:test";
import testnetV2 from "../deployments/11155931/curveball-v2-permissionless.json";
import legacyV2 from "../deployments/11155931/curveball-v2.json";
import { discoverAllTokens, type CreatorTokenClient } from "./creatorTokens";
import { activeDeploymentBlock, launchpadAddress, requireCurveballSdk, requireMarketSdk } from "./lib/web3";
import { zeroAddress, type Address } from "viem";

test("both testnet factories are scanned so earlier launches remain visible", async () => {
  const deploymentBlock = BigInt(testnetV2.deploymentBlock);
  expect(launchpadAddress?.toLowerCase()).toBe(testnetV2.factory.toLowerCase());
  expect(activeDeploymentBlock).toBe(deploymentBlock);
  const ranges: { address: string; fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    getBlockNumber: async () => deploymentBlock,
    getContractEvents: async ({ address, fromBlock, toBlock }: { address: string; fromBlock: bigint; toBlock: bigint }) => {
      ranges.push({ address, fromBlock, toBlock });
      return [];
    },
  } as unknown as CreatorTokenClient;

  expect(await discoverAllTokens(client, "v2")).toEqual([]);
  expect(ranges).toContainEqual({ address: testnetV2.factory, fromBlock: deploymentBlock, toBlock: deploymentBlock });
  expect(ranges).toContainEqual({ address: legacyV2.factory, fromBlock: 56_102_377n, toBlock: 56_107_376n });
});

test("a legacy launch retains its factory for market actions", async () => {
  const block = 56_102_377n;
  const token = "0x1111111111111111111111111111111111111111" as Address;
  const creator = "0x2222222222222222222222222222222222222222" as Address;
  const curve = "0x3333333333333333333333333333333333333333" as Address;
  const client = {
    getBlockNumber: async () => block,
    getContractEvents: async ({ address }: { address: Address }) => address.toLowerCase() === legacyV2.factory.toLowerCase()
      ? [{ args: { token, creator, name: "Old", symbol: "OLD", curve }, blockNumber: block }]
      : [],
    getBlock: async () => ({ timestamp: 1_000n }),
    readContract: async ({ functionName }: { functionName: string }) => ({
      curveSupply: 800_000n,
      supply: 1_000_000n,
      initialVQ: 10_000n,
      market: [curve, zeroAddress, 100, 2000, 1000, 0, zeroAddress],
      sold: 10_000n,
      ready: false,
      graduated: false,
      pool: zeroAddress,
      virtualQuote: 10_000n,
      virtualToken: 990_000n,
    })[functionName],
  } as unknown as CreatorTokenClient;

  const [found] = await discoverAllTokens(client, "v2");
  expect(found.address).toBe(token);
  expect(found.factory?.toLowerCase()).toBe(legacyV2.factory.toLowerCase());
  expect(requireMarketSdk(found.factory)).not.toBe(requireCurveballSdk());
  expect(requireMarketSdk(launchpadAddress)).toBe(requireCurveballSdk());
});
