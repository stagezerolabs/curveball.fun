import { expect, test } from "bun:test";
import { discoverAllTokens, type CreatorTokenClient } from "./creatorTokens";
import { activeDeploymentBlock, factoryVersion, launchpadAddress, legacyFactories } from "./lib/web3";
import { factoryForToken } from "./lib/marketFactories";
import { getAddress, zeroAddress, type Address } from "viem";

test("discovery scans every supported testnet factory from its deployment block", async () => {
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
  expect(ranges.some((range) => range.address === legacyFactories[0]?.address && range.fromBlock === legacyFactories[0]?.deploymentBlock)).toBe(true);
});

test("discovery and market access use each token's factory", async () => {
  const newToken = getAddress("0x0000000000000000000000000000000000000022");
  const newCurve = getAddress("0x0000000000000000000000000000000000000044");
  const creator = getAddress("0x0000000000000000000000000000000000000055");
  const oldFactory = getAddress("0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf");
  const newFactory = launchpadAddress!;
  const client = {
    getBlockNumber: async () => activeDeploymentBlock,
    getContractEvents: async ({ address, fromBlock }: { address: Address; fromBlock: bigint }) => {
      if (address.toLowerCase() === newFactory.toLowerCase() && fromBlock === activeDeploymentBlock)
        return [{ args: { token: newToken, curve: newCurve, creator, name: "New", symbol: "NEW" }, blockNumber: fromBlock }];
      if (legacyFactories.some((entry) => entry.address.toLowerCase() === address.toLowerCase())) return [];
      throw new Error(`Unexpected factory ${address}`);
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "supply") return 1_000_000n * 10n ** 18n;
      if (functionName === "curveSupply") return 800_000n * 10n ** 18n;
      if (functionName === "initialVQ") return 10n * 10n ** 18n;
      if (functionName === "market") return [newCurve, creator, 75, 5000, 2500, 0, creator];
      if (functionName === "sold" || functionName === "virtualQuote") return 10n * 10n ** 18n;
      if (functionName === "virtualToken") return 1_000_000n * 10n ** 18n;
      if (functionName === "ready" || functionName === "graduated") return false;
      if (functionName === "pool") return zeroAddress;
      throw new Error(`Unexpected ${functionName}`);
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber }),
  } as unknown as CreatorTokenClient;
  const tokens = await discoverAllTokens(client);
  expect(tokens.map(({ factory, feeBps }) => [factory, feeBps])).toEqual([[newFactory, 75]]);
  expect(factoryForToken(tokens[0].factory)).toBe(newFactory);
  expect(legacyFactories.some((entry) => entry.address === oldFactory)).toBe(true);
  expect(factoryForToken(oldFactory)).toBe(oldFactory);
  expect(factoryVersion(oldFactory)).toBe("V2 early");
  expect(factoryVersion(newFactory)).toMatch(/^V2(?:\.1)?$/);
});
