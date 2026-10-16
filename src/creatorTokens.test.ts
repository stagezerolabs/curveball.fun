import { expect, test } from "bun:test";
import { discoverAllTokens, type CreatorTokenClient } from "./creatorTokens";
import { activeDeploymentBlock, factoryVersion, launchpadAddress, legacyFactories } from "./lib/web3";
import { factoryForToken } from "./lib/marketFactories";
import { getAddress, zeroAddress, type Address } from "viem";

test("discovery scans only the V1 factory from its deployment block", async () => {
  const deploymentBlock = activeDeploymentBlock;
  expect(launchpadAddress).not.toBeNull();
  const ranges: { address: string; fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    getBlockNumber: async () => deploymentBlock,
    getContractEvents: async ({ address, fromBlock, toBlock }: { address: string; fromBlock: bigint; toBlock: bigint }) => {
      ranges.push({ address, fromBlock, toBlock });
      return [];
    },
  } as unknown as CreatorTokenClient;

  expect(await discoverAllTokens(client)).toEqual([]);
  expect(ranges).toContainEqual({ address: launchpadAddress!, fromBlock: deploymentBlock, toBlock: deploymentBlock });
  expect(legacyFactories).toEqual([]);
  expect(ranges).toHaveLength(1);
});

test("discovery and market access use the V1 factory and launch venue", async () => {
  const newToken = getAddress("0x0000000000000000000000000000000000000022");
  const newCurve = getAddress("0x0000000000000000000000000000000000000044");
  const creator = getAddress("0x0000000000000000000000000000000000000055");
  const oldFactory = getAddress("0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf");
  const newFactory = launchpadAddress!;
  const venue = getAddress("0x0000000000000000000000000000000000000066");
  const client = {
    getBlockNumber: async () => activeDeploymentBlock,
    getContractEvents: async ({ address, fromBlock }: { address: Address; fromBlock: bigint }) => {
      if (address.toLowerCase() === newFactory.toLowerCase() && fromBlock === activeDeploymentBlock)
        return [{ args: { token: newToken, curve: newCurve, creator, name: "New", symbol: "NEW" }, blockNumber: fromBlock }];
      throw new Error(`Unexpected factory ${address}`);
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "supply") return 1_000_000n * 10n ** 18n;
      if (functionName === "curveSupply") return 800_000n * 10n ** 18n;
      if (functionName === "initialVQ") return 10n * 10n ** 18n;
      if (functionName === "market") return [newCurve, creator, 75, 5000, 2500, 0, creator];
      if (functionName === "venueOf") return venue;
      if (functionName === "isMock") return true;
      if (functionName === "sold" || functionName === "virtualQuote") return 10n * 10n ** 18n;
      if (functionName === "virtualToken") return 1_000_000n * 10n ** 18n;
      if (functionName === "ready" || functionName === "graduated") return false;
      if (functionName === "pool") return zeroAddress;
      throw new Error(`Unexpected ${functionName}`);
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber }),
  } as unknown as CreatorTokenClient;
  let showNewToken!: (tokens: Awaited<ReturnType<typeof discoverAllTokens>>) => void;
  const firstBatch = new Promise<Awaited<ReturnType<typeof discoverAllTokens>>>((resolve) => { showNewToken = resolve; });
  const discovery = discoverAllTokens(client, (batch) => {
    if (batch.length) showNewToken(batch);
  });
  expect((await firstBatch).map(({ address }) => address)).toEqual([newToken]);
  const tokens = await discovery;
  expect(tokens.map(({ factory, feeBps }) => [factory, feeBps])).toEqual([[newFactory, 75]]);
  expect(tokens[0].mockVenue).toBe(true);
  expect(factoryForToken(tokens[0].factory)).toBe(newFactory);
  expect(() => factoryForToken(oldFactory)).toThrow("retired factory");
  expect(factoryVersion(newFactory)).toBe("V1");
});
